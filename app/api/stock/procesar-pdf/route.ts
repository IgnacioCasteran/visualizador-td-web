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

  /*
   * Formato VMG:
   *
   * BA419 Ford Fiesta 1.6 - Ka 1.0-1.6 3226 4,000 UN ...
   * RF003 LIQ.REFR.CONC.ORG.ROJOx1L 60,000 UN ...
   *
   * El código de pieza no siempre empieza con BA y COD. HIST. puede venir vacío.
   * Tomamos como cantidad el número inmediatamente anterior a UN.
   */
  const rowRegex =
    /^\s*([A-Z0-9][A-Z0-9./_-]{2,})\s+(.+?)\s+(?:(\d{4})\s+)?(\d+(?:[.,]\d+)?)\s+UN\b.*$/gim;

  for (const match of text.matchAll(rowRegex)) {
    const supplierCode = normalizeCode(match[1]);
    const description = cleanDescription(match[2]);
    const quantity = parseQuantity(match[4]);

    if (!isReasonableCode(supplierCode) || !description || quantity <= 0) {
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



/* =========================================================

   CAPEMI / A. GIACOMELLI S.A.

   ========================================================= */



/**

 * Formato CAPEMI real:

 *

 * 02-1433 [002014330] BUJE BARRA ESTABILIZADORA (ALTO)

 * 10,00 Unidades 1.606,83 IVA 21% $ 16.068,30

 *

 * 02-1143/1 [002011431] BUJE BARRA ESTABILIZADORA...

 * 10,00 Unidades ...

 *

 * Para la equivalencia nos interesa:

 * - supplierCode: 02-1433 / 01-1428 / 02-1143/1 ...

 * - description: descripción del artículo

 * - quantity: 10 / 20 / 50 ...

 *

 * El código entre corchetes es un código interno de CAPEMI y no se usa

 * para construir el código TD.

 */

function parseCapemi(text: string): ParsedItem[] {

  const items: ParsedItem[] = [];



  const lines = text

    .split(/\r?\n/)

    .map((line) => line.replace(/\s+/g, " ").trim())

    .filter(Boolean);



  const rowRegex =

    /^(\d{2}-\d{4}(?:\/\d+)?)\s+\[([A-Z0-9]+)\]\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+UNIDADES?\b.*$/i;



  for (const line of lines) {

    const match = line.match(rowRegex);



    if (!match) continue;



    const supplierCode = normalizeCode(match[1]);

    const description = cleanDescription(match[3]);

    const quantity = parseQuantity(match[4]);



    if (!supplierCode || !description || quantity <= 0) {

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

   * IMPORTANTE - ORDEN REAL DE EXTRACCIÓN DEL PDF SERRAT

   *

   * Visualmente la factura muestra:

   *

   *   10908 | FUELLES DE SUSPENSION | 5.00 | 7,653.30 | 38,266.50

   *

   * Pero el motor PDF puede entregar ese mismo renglón así:

   *

   *   5.00

   *   7,653.30

   *   38,266.50

   *   10908

   *   FUELLES DE SUSPENSION

   *

   * Por eso NO debemos depender del orden visual de las columnas.

   *

   * Este parser soporta:

   * 1) orden de extracción real: cantidad -> precio -> total -> código -> detalle

   * 2) orden tradicional: código -> detalle -> cantidad -> precio -> total

   *

   * ZF y VMG NO se tocan.

   */



  const lines = text

    .split(/\r?\n/)

    .map((line) => line.replace(/\s+/g, " ").trim())

    .filter(Boolean);



  const quantityRegex = /^\d+(?:[.,]\d{2,3})$/;

  const moneyRegex = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;

  const codeRegex = /^\d{5}$/;



  function validDescription(value: string) {

    const normalized = value.trim().toUpperCase();



    if (!normalized || normalized.length < 3) return false;



    const forbidden = [

      "SUBTOTAL",

      "NETO",

      "TOTAL",

      "PESOS",

      "TRANSPORTE",

      "OBSERVACIONES:",

      "DETALLE DE FACTURAS PENDIENTES",

    ];



    return !forbidden.some(

      (word) =>

        normalized === word ||

        normalized.startsWith(word)

    );

  }



  /*

   * ESTRATEGIA PRINCIPAL:

   *

   * cantidad

   * precio

   * total

   * código

   * descripción

   */

  for (let index = 0; index <= lines.length - 5; index += 1) {

    const quantityLine = lines[index];

    const priceLine = lines[index + 1];

    const totalLine = lines[index + 2];

    const codeLine = lines[index + 3];

    const descriptionLine = lines[index + 4];



    if (!quantityRegex.test(quantityLine)) continue;

    if (!moneyRegex.test(priceLine)) continue;

    if (!moneyRegex.test(totalLine)) continue;

    if (!codeRegex.test(codeLine)) continue;

    if (!validDescription(descriptionLine)) continue;



    const quantity = parseQuantity(quantityLine);



    if (quantity <= 0) continue;



    items.push({

      supplierCode: codeLine,

      description: cleanDescription(descriptionLine),

      quantity,

    });



    // Saltamos los cuatro tokens siguientes porque ya forman parte

    // del artículo que acabamos de reconocer.

    index += 4;

  }



  if (items.length > 0) {

    return consolidate(items);

  }



  /*

   * FALLBACK 1:

   * Algunas versiones/extractores sí devuelven cada fila en el orden visual:

   *

   * código + detalle + cantidad + precio + total

   */

  const visualRowRegex =

    /^\s*(\d{5})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([\d.,]+)\s+([\d.,]+)\s*$/i;



  for (const line of lines) {

    const match = line.match(visualRowRegex);



    if (!match) continue;



    const code = normalizeCode(match[1]);

    const description = cleanDescription(match[2]);

    const quantity = parseQuantity(match[3]);



    if (!code || !validDescription(description) || quantity <= 0) {

      continue;

    }



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

   * FALLBACK 2:

   * Si el PDF agrupa algunos tokens, buscamos el patrón completo sobre

   * texto normalizado. Este fallback es exclusivo de Serrat.

   */

  const flat = lines.join(" ");



  const extractionOrderRegex =

    /\b(\d+(?:[.,]\d{2,3}))\s+(\d{1,3}(?:,\d{3})*\.\d{2})\s+(\d{1,3}(?:,\d{3})*\.\d{2})\s+(\d{5})\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 /().,+\-]{2,}?)(?=\s+\d+(?:[.,]\d{2,3})\s+\d{1,3}(?:,\d{3})*\.\d{2}\s+\d{1,3}(?:,\d{3})*\.\d{2}\s+\d{5}\b|\s+TRANSPORTE\b|\s+SUBTOTAL\b|\s+TOTAL\b|$)/gi;



  for (const match of flat.matchAll(extractionOrderRegex)) {

    const quantity = parseQuantity(match[1]);

    const code = normalizeCode(match[4]);

    const description = cleanDescription(match[5]);



    if (!code || !validDescription(description) || quantity <= 0) {

      continue;

    }



    items.push({

      supplierCode: code,

      description,

      quantity,

    });

  }



  return consolidate(items);

}





/**

 * SERRAT - lector geométrico del PDF.

 *

 * Este es el punto clave para este proveedor:

 * extractText() puede alterar el orden de lectura de las columnas aunque

 * visualmente la tabla esté perfecta. En vez de confiar en ese string,

 * tomamos los elementos originales de cada página, los agrupamos por

 * coordenada Y (renglón) y los ordenamos por X (izquierda -> derecha).

 *

 * Así reconstruimos exactamente:

 *

 * 10908 | FUELLES DE SUSPENSION | 5.00 | 7,653.30 | 38,266.50

 *

 * sin afectar ZF ni VMG.

 */

async function parseSerratFromPdf(pdf: any): Promise<ParsedItem[]> {

  const result: ParsedItem[] = [];



  const pageCount = Number(pdf?.numPages ?? 0);



  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {

    const page = await pdf.getPage(pageNumber);

    const content = await page.getTextContent();



    const positioned = (content.items ?? [])

      .map((item: any) => {

        const transform = Array.isArray(item?.transform)

          ? item.transform

          : [];



        return {

          text: String(item?.str ?? "").replace(/\s+/g, " ").trim(),

          x: Number(transform[4] ?? 0),

          y: Number(transform[5] ?? 0),

        };

      })

      .filter(

        (item: { text: string; x: number; y: number }) =>

          item.text &&

          Number.isFinite(item.x) &&

          Number.isFinite(item.y)

      );



    // Primero ordenamos visualmente de arriba hacia abajo.

    positioned.sort(

      (

        a: { text: string; x: number; y: number },

        b: { text: string; x: number; y: number }

      ) => {

        const yDiff = b.y - a.y;



        if (Math.abs(yDiff) > 1.5) {

          return yDiff;

        }



        return a.x - b.x;

      }

    );



    const rows: Array<{

      y: number;

      cells: Array<{ text: string; x: number }>;

    }> = [];



    for (const item of positioned) {

      let row = rows.find(

        (candidate) => Math.abs(candidate.y - item.y) <= 1.8

      );



      if (!row) {

        row = {

          y: item.y,

          cells: [],

        };



        rows.push(row);

      }



      row.cells.push({

        text: item.text,

        x: item.x,

      });

    }



    rows.sort((a, b) => b.y - a.y);



    for (const row of rows) {

      row.cells.sort((a, b) => a.x - b.x);



      const line = row.cells

        .map((cell) => cell.text)

        .join(" ")

        .replace(/\s+/g, " ")

        .trim();



      /*

       * Ejemplo reconstruido:

       * 10908 FUELLES DE SUSPENSION 5.00 7,653.30 38,266.50

       */

      const match = line.match(

        /^\s*(\d{5})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([\d.,]+)\s+([\d.,]+)\s*$/

      );



      if (!match) continue;



      const code = normalizeCode(match[1]);

      const description = cleanDescription(match[2]);

      const quantity = parseQuantity(match[3]);



      if (!code || quantity <= 0) continue;



      // Evitamos encabezados/totales por seguridad.

      if (

        !/[A-ZÁÉÍÓÚÑ]/i.test(description) ||

        /^(SUBTOTAL|NETO|TOTAL|TRANSPORTE|OBSERVACIONES)/i.test(

          description

        )

      ) {

        continue;

      }



      result.push({

        supplierCode: code,

        description,

        quantity,

      });

    }

  }



  return consolidate(result);

}



/* =========================================================

   AG / ANICETO GOMEZ S.A.

   ========================================================= */



/**
 * Formato real de la factura AG:
 *
 * 1  1-041171   CHEVROLET S-10 ...                    4  123723,10  494.892,40
 * 1  4-235085W  TOYOTA Hilux 3.0 OffRoad 1996-2015   2  158910,54  317.821,08
 * 4  1-071125R  FIAT Palio Weekend ...                4  103684,64  10% 373.264,70
 *
 * IMPORTANTE:
 * - AG no usa únicamente códigos "1-XXXXXX".
 * - Puede traer otros prefijos internos (ej. 4-...) y sufijos con letras.
 * - Algunas facturas agregan columna de descuento (ej. 10%).
 * - La descripción puede continuar en una segunda línea.
 *
 * El prefijo TD NO se decide acá: lo aporta el selector de familias.
 */
function parseAg(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];

  const flat = text
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const agCode = String.raw`\d{1,2}-[A-Z0-9]+`;

  /*
   * Fallback textual.
   * Soporta:
   *   item + código + descripción + cantidad + precio + total
   *   item + código + descripción + cantidad + precio + descuento% + total
   */
  const rowRegex = new RegExp(
    String.raw`\b\d+\s+(${agCode})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([\d.,]+)\s+(?:\d+(?:[.,]\d+)?%\s+)?([\d.,]+)(?=\s+\d+\s+${agCode}\b|\s+TOTAL\b|\s+INDICADOR\b|\s+PERC\b|\s+IVA[_\s]|$)`,
    "gi"
  );

  for (const match of flat.matchAll(rowRegex)) {
    const supplierCode = normalizeCode(match[1]);
    const description = cleanDescription(match[2]);
    const quantity = parseQuantity(match[3]);

    if (!supplierCode || !description || quantity <= 0) {
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
 * AG - lector geométrico.
 *
 * Para AG tomamos las coordenadas reales del PDF y leemos por columnas.
 * Esto evita depender del orden en que unpdf concatena el texto.
 *
 * Soporta:
 * - códigos 1-072213, 4-235085W, 1-071125R, 1-251047TP, etc.;
 * - columna opcional "Desc" (10%);
 * - descripciones que continúan en una segunda línea.
 *
 * Esto SOLO se ejecuta para AG y no modifica ZF, VMG, SERRAT ni CAPEMI.
 */
async function parseAgFromPdf(pdf: any): Promise<ParsedItem[]> {
  const result: ParsedItem[] = [];
  const pageCount = Number(pdf?.numPages ?? 0);

  const codeRegex = /^\d{1,2}-[A-Z0-9]+$/i;
  const itemRegex = /^\d+$/;
  const quantityRegex = /^\d+(?:[.,]\d+)?$/;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    const positioned = (content.items ?? [])
      .map((item: any) => {
        const transform = Array.isArray(item?.transform)
          ? item.transform
          : [];

        return {
          text: String(item?.str ?? "").replace(/\s+/g, " ").trim(),
          x: Number(transform[4] ?? 0),
          y: Number(transform[5] ?? 0),
        };
      })
      .filter(
        (item: { text: string; x: number; y: number }) =>
          item.text &&
          Number.isFinite(item.x) &&
          Number.isFinite(item.y)
      );

    positioned.sort(
      (
        a: { text: string; x: number; y: number },
        b: { text: string; x: number; y: number }
      ) => {
        const yDiff = b.y - a.y;

        if (Math.abs(yDiff) > 1.5) {
          return yDiff;
        }

        return a.x - b.x;
      }
    );

    const rows: Array<{
      y: number;
      cells: Array<{ text: string; x: number }>;
    }> = [];

    for (const item of positioned) {
      let row = rows.find(
        (candidate) => Math.abs(candidate.y - item.y) <= 1.8
      );

      if (!row) {
        row = {
          y: item.y,
          cells: [],
        };

        rows.push(row);
      }

      row.cells.push({
        text: item.text,
        x: item.x,
      });
    }

    rows.sort((a, b) => b.y - a.y);

    let lastInsertedIndex: number | null = null;
    let lastItemRowY: number | null = null;

    for (const row of rows) {
      row.cells.sort((a, b) => a.x - b.x);

      const itemCell = row.cells.find(
        (cell) => cell.x < 25 && itemRegex.test(cell.text)
      );

      const codeCell = row.cells.find(
        (cell) =>
          cell.x >= 20 &&
          cell.x < 100 &&
          codeRegex.test(cell.text)
      );

      const quantityCell = row.cells.find(
        (cell) =>
          cell.x >= 395 &&
          cell.x < 445 &&
          quantityRegex.test(cell.text)
      );

      /*
       * Descripción visual de AG:
       * empieza aproximadamente en x=103 y termina antes de Cantidad.
       * "Despacho" está en esa zona pero en estas facturas viene vacío.
       */
      const description = cleanDescription(
        row.cells
          .filter((cell) => cell.x >= 90 && cell.x < 395)
          .map((cell) => cell.text)
          .join(" ")
      );

      if (itemCell && codeCell && quantityCell) {
        const quantity = parseQuantity(quantityCell.text);

        if (!description || quantity <= 0) {
          lastInsertedIndex = null;
          continue;
        }

        result.push({
          supplierCode: normalizeCode(codeCell.text),
          description,
          quantity,
        });

        lastInsertedIndex = result.length - 1;
        lastItemRowY = row.y;
        continue;
      }

      /*
       * Continuación de descripción:
       * ej. "2002-2012" debajo de
       * "FIAT Palio Weekend Fase II / Strada Adventure".
       *
       * Solo la anexamos si:
       * - venimos de un artículo válido;
       * - no aparece un nuevo código/cantidad;
       * - hay texto en la columna descripción;
       * - no estamos entrando en totales/resumen.
       */
      if (
        lastInsertedIndex !== null &&
        lastItemRowY !== null &&
        Math.abs(lastItemRowY - row.y) <= 14 &&
        !itemCell &&
        !codeCell &&
        !quantityCell &&
        description &&
        !/^(INDICADOR|TOTAL|DESCUENTO|IVA|PERC|SON:|CAE|VTO|PÁGINA|PAGINA)/i.test(
          description
        )
      ) {
        result[lastInsertedIndex].description = cleanDescription(
          `${result[lastInsertedIndex].description} ${description}`
        );

        // Permitimos otra continuación inmediata, pero no arrastramos
        // descripciones hacia el bloque de totales/resumen.
        lastItemRowY = row.y;
      }
    }
  }

  return consolidate(result);
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



type KnownFormat = "ZF" | "VMG" | "SERRAT" | "CAPEMI" | "AG";



type SelectedBrandHint = {

  erpId?: number;

  name?: string | null;

  prefix?: string | null;

};



function textHasVmgStructure(text: string): boolean {
  const haystack = text.toUpperCase();

  const hasVmgColumns =
    haystack.includes("Nº PIEZA") ||
    haystack.includes("N° PIEZA") ||
    haystack.includes("NRO PIEZA") ||
    haystack.includes("COD. HIST.");

  const hasVmgRow =
    /^\s*[A-Z0-9][A-Z0-9./_-]{2,}\s+.+?\s+(?:(?:\d{4})\s+)?\d+(?:[.,]\d+)?\s+UN\b.*$/im.test(
      text
    );

  return hasVmgColumns && hasVmgRow;
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



  if (

    names.includes("CAPEMI") ||

    names.includes("GIACOMELLI")

  ) {

    return "CAPEMI";

  }



  if (

    names.includes("AG RESORTES") ||

    names.includes("AG KIT PROGRESIVOS") ||

    names.includes("ANICETO GOMEZ")

  ) {

    return "AG";

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



  if (

    haystack.includes("CAPEMI") ||

    haystack.includes("A. GIACOMELLI S.A.") ||

    haystack.includes("CAPEMI@CAPEMI.AR") ||

    haystack.includes("30-56661376-6")

  ) {

    return "CAPEMI";

  }



  if (

    haystack.includes("ANICETO GOMEZ S.A.") ||

    haystack.includes("WWW.AG.COM.AR") ||

    haystack.includes("30-66138495-2") ||

    haystack.includes("GRUPO AG")

  ) {

    return "AG";

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



    case "CAPEMI":

      return { parser: "CAPEMI", items: parseCapemi(text) };



    case "AG":

      return { parser: "AG", items: parseAg(text) };

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

    { parser: "CAPEMI_FALLBACK", items: parseCapemi(text) },

    { parser: "AG_FALLBACK", items: parseAg(text) },

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



    const selectedFormat = detectFormatFromSelectedBrands(

      brandName,

      selectedBrands

    );



    const pdfDetectedFormat = detectFormatFromPdfText(text);



    let parsed: ParserResult;



    /*

     * SERRAT se procesa directamente desde las coordenadas del PDF.

     * NO usamos extractText() para reconstruir sus filas porque ese método

     * es justamente el que estaba mezclando las columnas.

     */

    if (

      selectedFormat === "SERRAT" ||

      pdfDetectedFormat === "SERRAT"

    ) {

      const serratItems = await parseSerratFromPdf(pdf);



      if (serratItems.length > 0) {

        parsed = {

          parser: "SERRAT_GEOMETRIC",

          items: serratItems,

        };

      } else {

        // Conservamos el parser textual como respaldo.

        parsed = {

          parser: "SERRAT_TEXT_FALLBACK",

          items: parseSerrat(text),

        };

      }

    } else if (

      selectedFormat === "AG" ||

      pdfDetectedFormat === "AG"

    ) {

      const agItems = await parseAgFromPdf(pdf);



      if (agItems.length > 0) {

        parsed = {

          parser: "AG_GEOMETRIC",

          items: agItems,

        };

      } else {

        parsed = {

          parser: "AG_TEXT_FALLBACK",

          items: parseAg(text),

        };

      }

    } else {

      // ZF, VMG y CAPEMI siguen exactamente con la lógica que ya funciona.

      parsed = parseInvoice(

        text,

        brandName,

        selectedBrands

      );

    }



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
