import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

type ParsedItem = {
  supplierCode: string;
  description: string;
  quantity: number;
};

type ParserResult = {
  parser: string;
  items: ParsedItem[];
};

function normalizeCode(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function cleanDescription(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+-\s*$/g, "")
    .trim();
}

function parseQuantity(value: string): number {
  const raw = value.trim().replace(/\s/g, "");

  if (!raw) return 0;

  if (raw.includes(",") && raw.includes(".")) {
    const lastComma = raw.lastIndexOf(",");
    const lastDot = raw.lastIndexOf(".");

    if (lastComma > lastDot) {
      const normalized = raw.replace(/\./g, "").replace(",", ".");
      const number = Number(normalized);
      return Number.isFinite(number) ? number : 0;
    }

    const normalized = raw.replace(/,/g, "");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  if (raw.includes(",")) {
    const normalized = raw.replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  const number = Number(raw);
  return Number.isFinite(number) ? number : 0;
}

function isReasonableCode(code: string): boolean {
  const normalized = normalizeCode(code).toUpperCase();

  if (!normalized) return false;

  const forbidden = [
    "TOTAL",
    "SUBTOTAL",
    "NETO",
    "IVA",
    "FACTURA",
    "REMITO",
    "TRANSPORTE",
    "OBSERVACIONES",
    "CODIGO",
    "CÓDIGO",
    "ARTICULO",
    "ARTÍCULO",
    "DETALLE",
    "CANTIDAD",
    "PRECIO",
    "DESCUENTOS",
  ];

  if (
    forbidden.some(
      (word) =>
        normalized === word ||
        normalized.startsWith(`${word} `)
    )
  ) {
    return false;
  }

  return /[A-Z0-9]/.test(normalized);
}

function consolidate(items: ParsedItem[]): ParsedItem[] {
  const map = new Map<string, ParsedItem>();

  for (const item of items) {
    const code = normalizeCode(item.supplierCode);
    const description = cleanDescription(item.description);
    const quantity = Number(item.quantity);

    if (!isReasonableCode(code)) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const key = code.toUpperCase();
    const existing = map.get(key);

    if (existing) {
      existing.quantity += quantity;

      if (
        (!existing.description ||
          existing.description.length < 4) &&
        description
      ) {
        existing.description = description;
      }
    } else {
      map.set(key, {
        supplierCode: code,
        description,
        quantity,
      });
    }
  }

  return Array.from(map.values()).map((item) => ({
    ...item,
    quantity: Number(item.quantity.toFixed(3)),
  }));
}

/* =========================================================
   ZF / SACHS
   ========================================================= */

function parseZf(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];

  const rowRegex =
    /^\s*\d+\s+(\d{3}\s+\d{3})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(?:PZA|UN|UNI|UNIDAD(?:ES)?|KIT|JGO)\b.*$/gim;

  for (const match of text.matchAll(rowRegex)) {
    items.push({
      supplierCode: normalizeCode(match[1]),
      description: cleanDescription(match[2]),
      quantity: parseQuantity(match[3]),
    });
  }

  return consolidate(items);
}

/* =========================================================
   VMG
   ========================================================= */

function parseVmg(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];

  const rowRegex =
    /^\s*(BA[A-Z0-9]+)\s+(.+?)\s+(\d{4})\s+(\d+(?:[.,]\d+)?)\s+UN\b.*$/gim;

  for (const match of text.matchAll(rowRegex)) {
    items.push({
      supplierCode: normalizeCode(match[1]),
      description: cleanDescription(match[2]),
      quantity: parseQuantity(match[4]),
    });
  }

  return consolidate(items);
}

/* =========================================================
   SERRAT
   ========================================================= */

/**
 * Esta versión NO depende de que unpdf conserve exactamente
 * un renglón por artículo.
 *
 * La factura real de Serrat trae, por ejemplo:
 *
 *   10908 FUELLES DE SUSPENSION 5.00 7,653.30 38,266.50
 *   20001 KIT DE TRANSMISION   10.00 6,814.08 68,140.80
 *   40055 TOPES DE SUSPENSION  10.00 2,225.76 22,257.60
 *
 * En algunos PDFs unpdf puede insertar saltos de línea dentro
 * de la tabla. Por eso primero aplastamos TODOS los espacios
 * y luego buscamos la estructura de la fila.
 */
function parseSerrat(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];

  /*
   * Formato Serrat real:
   *
   * 10908 FUELLES DE SUSPENSION 5.00 7,653.30 38,266.50
   * 20001 KIT DE TRANSMISION   10.00 6,814.08 68,140.80
   * 40055 TOPES DE SUSPENSION  10.00 2,225.76 22,257.60
   *
   * La factura también contiene códigos de otras familias (200xx, 310xx,
   * 320xx, 400xx), pero el código de proveedor SIEMPRE es el primer bloque
   * numérico de 5 dígitos.
   *
   * A diferencia del intento anterior, acá NO aplanamos todo el PDF de entrada.
   * Primero probamos línea por línea, que en esta factura viene perfectamente
   * estructurado. Si unpdf llegara a romper alguna fila, hacemos un fallback
   * a texto aplanado después.
   */

  const lineRegex =
    /^\s*(\d{5})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([\d.,]+)\s+([\d.,]+)\s*$/i;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(lineRegex);

    if (!match) continue;

    const code = normalizeCode(match[1]);
    const description = cleanDescription(match[2]);
    const quantity = parseQuantity(match[3]);

    if (!code || !description || quantity <= 0) continue;

    items.push({
      supplierCode: code,
      description,
      quantity,
    });
  }

  if (items.length > 0) {
    return consolidate(items);
  }

  /*
   * Fallback tolerante a saltos internos del PDF.
   */
  const flat = text
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const money = String.raw`\d{1,3}(?:,\d{3})*\.\d{2}`;

  const rowRegex = new RegExp(
    String.raw`\b(\d{5})\s+` +
      String.raw`([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 /().,+\-]{2,}?)\s+` +
      String.raw`(\d+(?:\.\d{2,3}))\s+` +
      String.raw`(${money})\s+` +
      String.raw`(${money})(?=\s|$)`,
    "gi"
  );

  for (const match of flat.matchAll(rowRegex)) {
    const code = normalizeCode(match[1]);
    const description = cleanDescription(match[2]);
    const quantity = parseQuantity(match[3]);

    if (!code || !description || quantity <= 0) continue;

    items.push({
      supplierCode: code,
      description,
      quantity,
    });
  }

  return consolidate(items);
}

/* =========================================================
   GENÉRICOS
   ========================================================= */

function parseGenericWithUnit(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];

  const rowRegex =
    /^\s*([A-Z0-9][A-Z0-9./_-]*(?:\s+[A-Z0-9][A-Z0-9./_-]*){0,2})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(?:UNIDADES?|UN|PZA|UNI|KIT|JGO)\b.*$/gim;

  for (const match of text.matchAll(rowRegex)) {
    const supplierCode = normalizeCode(match[1]);
    const description = cleanDescription(match[2]);
    const quantity = parseQuantity(match[3]);

    if (!isReasonableCode(supplierCode) || quantity <= 0) {
      continue;
    }

    items.push({
      supplierCode,
      description,
      quantity,
    });
  }

  return consolidate(items);
}

/**
 * Código + descripción + cantidad + precio + total.
 * También trabaja sobre texto aplanado para tolerar saltos
 * de línea internos generados por el PDF.
 */
function parseGenericNumericTable(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];

  const flat = text
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const rowRegex =
    /\b([A-Z0-9][A-Z0-9./_-]{2,})\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 /().,+\-]{2,}?)\s+(\d+(?:[.,]\d+)?)\s+([\d.,]+)\s+([\d.,]+)(?=\s|$)/gi;

  for (const match of flat.matchAll(rowRegex)) {
    const code = normalizeCode(match[1]);
    const description = cleanDescription(match[2]);
    const quantity = parseQuantity(match[3]);

    if (!isReasonableCode(code)) continue;
    if (!/[A-ZÁÉÍÓÚÑ]/i.test(description)) continue;
    if (quantity <= 0) continue;

    items.push({
      supplierCode: code,
      description,
      quantity,
    });
  }

  return consolidate(items);
}

/* =========================================================
   SELECCIÓN AUTOMÁTICA
   ========================================================= */

type KnownFormat = "ZF" | "VMG" | "SERRAT";

type SelectedBrandHint = {
  erpId?: number;
  name?: string | null;
  prefix?: string | null;
};

function textHasVmgStructure(text: string): boolean {
  const haystack = text.toUpperCase();

  return (
    haystack.includes("Nº PIEZA") ||
    haystack.includes("N° PIEZA") ||
    haystack.includes("NRO PIEZA") ||
    haystack.includes("COD. HIST.")
  ) && /\bBA[A-Z0-9]{2,}\b/.test(haystack);
}

function detectFormatFromSelectedBrands(
  brandName: string | null,
  selectedBrands: SelectedBrandHint[]
): KnownFormat | null {
  const names = [
    brandName ?? "",
    ...selectedBrands.map((brand) => brand.name ?? ""),
  ]
    .join(" | ")
    .toUpperCase();

  /*
   * La selección que hace el usuario es nuestra señal más confiable.
   * No dependemos de que unpdf haya podido extraer el logo o razón social.
   */
  if (
    names.includes("VMG") ||
    names.includes("BOMBAS DE AGUA") && selectedBrands.some(
      (brand) => String(brand.prefix ?? "").trim() === "50"
    )
  ) {
    return "VMG";
  }

  if (
    names.includes("SACHS") ||
    names.includes("ZF")
  ) {
    return "ZF";
  }

  if (
    names.includes("SERRAT")
  ) {
    return "SERRAT";
  }

  return null;
}

function detectFormatFromPdfText(text: string): KnownFormat | null {
  const haystack = text.toUpperCase();

  if (
    haystack.includes("ZF ARGENTINA S.A.") ||
    haystack.includes("SACHS.SFR@ZF.COM") ||
    haystack.includes("ZFSACHS.COM.AR") ||
    (
      haystack.includes("POS COD.COM.") &&
      haystack.includes("CANTIDAD UP")
    )
  ) {
    return "ZF";
  }

  /*
   * En algunas facturas VMG, unpdf NO extrae "VMG S.A." del encabezado,
   * aunque se vea perfecto en el PDF. Por eso también reconocemos la
   * estructura de columnas + los códigos BAxxx.
   */
  if (
    haystack.includes("VMG S.A.") ||
    haystack.includes("VMG S A") ||
    haystack.includes("BOMBAS DE AGUA") ||
    textHasVmgStructure(text)
  ) {
    return "VMG";
  }

  if (
    haystack.includes("SERRAT S.R.L.") ||
    haystack.includes("SERRATSRL.COM.AR") ||
    haystack.includes("INFO@SERRATSRL.COM.AR") ||
    haystack.includes("30-56744837-8")
  ) {
    return "SERRAT";
  }

  return null;
}

function runKnownParser(format: KnownFormat, text: string): ParserResult {
  switch (format) {
    case "ZF":
      return { parser: "ZF", items: parseZf(text) };

    case "VMG":
      return { parser: "VMG", items: parseVmg(text) };

    case "SERRAT":
      return { parser: "SERRAT", items: parseSerrat(text) };
  }
}

function parseInvoice(
  text: string,
  brandName: string | null,
  selectedBrands: SelectedBrandHint[]
): ParserResult {
  /*
   * ORDEN DE CONFIANZA:
   *
   * 1) Familias que eligió el usuario.
   * 2) Señales del texto del PDF.
   * 3) Parsers genéricos.
   *
   * Esto evita exactamente los dos errores que vimos:
   *
   * - ZF: el genérico convertía "131 315 704" en código.
   * - VMG: el genérico convertía "BA419 Ford Fiesta" en código.
   *
   * Si sabemos que la factura corresponde a SACHS / VMG / SERRAT,
   * JAMÁS dejamos que un parser genérico pise el específico.
   */
  const selectedFormat = detectFormatFromSelectedBrands(
    brandName,
    selectedBrands
  );

  if (selectedFormat) {
    const specific = runKnownParser(selectedFormat, text);

    if (specific.items.length > 0) {
      return specific;
    }
  }

  const pdfFormat = detectFormatFromPdfText(text);

  if (pdfFormat) {
    const specific = runKnownParser(pdfFormat, text);

    if (specific.items.length > 0) {
      return specific;
    }
  }

  /*
   * Recién para formatos realmente desconocidos usamos los genéricos.
   */
  const genericCandidates: ParserResult[] = [
    {
      parser: "GENERIC_UNIT",
      items: parseGenericWithUnit(text),
    },
    {
      parser: "GENERIC_NUMERIC_TABLE",
      items: parseGenericNumericTable(text),
    },
  ];

  genericCandidates.sort((a, b) => b.items.length - a.items.length);

  if (genericCandidates[0].items.length > 0) {
    return genericCandidates[0];
  }

  /*
   * Último respaldo estructural: útil si cambia el encabezado del proveedor
   * pero conserva la misma tabla.
   */
  const structuralFallbacks: ParserResult[] = [
    { parser: "ZF_FALLBACK", items: parseZf(text) },
    { parser: "VMG_FALLBACK", items: parseVmg(text) },
    { parser: "SERRAT_FALLBACK", items: parseSerrat(text) },
  ];

  structuralFallbacks.sort((a, b) => b.items.length - a.items.length);

  return structuralFallbacks[0];
}

/* =========================================================
   ENDPOINT
   ========================================================= */

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const file = formData.get("file");
    const brandErpId = Number(
      formData.get("brandErpId") ?? 0
    );
    const brandName =
      String(formData.get("brandName") ?? "").trim() ||
      null;
    const brandPrefix =
      String(formData.get("brandPrefix") ?? "").trim() ||
      null;

    let selectedBrands: SelectedBrandHint[] = [];

    try {
      const parsedSelectedBrands = JSON.parse(
        String(formData.get("selectedBrands") ?? "[]")
      );

      if (Array.isArray(parsedSelectedBrands)) {
        selectedBrands = parsedSelectedBrands;
      }
    } catch {
      selectedBrands = [];
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No se recibió ningún PDF." },
        { status: 400 }
      );
    }

    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      return NextResponse.json(
        { error: "El archivo debe ser un PDF." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "El PDF supera el límite de 10 MB." },
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(brandErpId) ||
      brandErpId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Seleccioná una marca / familia TD válida.",
        },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(
      await file.arrayBuffer()
    );

    const pdf = await getDocumentProxy(bytes);

    const extraction = await extractText(pdf, {
      mergePages: true,
    });

    const text = Array.isArray(extraction.text)
      ? extraction.text.join("\n")
      : extraction.text;

    if (!text || !text.trim()) {
      return NextResponse.json(
        {
          error:
            "No se pudo extraer texto del PDF. Puede ser una factura escaneada como imagen.",
        },
        { status: 422 }
      );
    }

    const parsed = parseInvoice(text, brandName, selectedBrands);

    // Log útil solamente en desarrollo.
    console.log(
      `[stock/pdf] parser=${parsed.parser} items=${parsed.items.length} file=${file.name}`
    );
    console.log(
      "[stock/pdf] familias seleccionadas:",
      selectedBrands.map((brand) => `${brand.prefix ?? "?"}-${brand.name ?? ""}`)
    );

    if (parsed.items.length > 0) {
      console.log(
        "[stock/pdf] primeros códigos:",
        parsed.items.slice(0, 8).map((item) => item.supplierCode)
      );
    }

    if (parsed.items.length === 0) {
      // No devolvemos el PDF entero al navegador, pero sí
      // información mínima para diagnosticar formatos futuros.
      const preview = text
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200);

      console.warn(
        "[stock/pdf] No se detectaron artículos. Preview:",
        preview
      );

      return NextResponse.json(
        {
          error:
            "La factura se pudo leer, pero no se encontraron renglones de artículos con suficiente seguridad.",
          parser: parsed.parser,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      totalPages: extraction.totalPages,
      brand: {
        erpId: brandErpId,
        name: brandName,
        prefix: brandPrefix,
      },
      selectedBrands,
      parser: parsed.parser,
      items: parsed.items,
      message: `${parsed.items.length} artículo(s) detectados con ${parsed.parser}.`,
    });
  } catch (error) {
    console.error(
      "Error procesando PDF de stock:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error inesperado al procesar el PDF.",
      },
      { status: 500 }
    );
  }
}
