"use client";

import Image from "next/image";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Link2,
  Loader2,
  Search,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import NavigationLoadingLink from "@/components/NavigationLoadingLink";
import LogoutButton from "@/components/LogoutButton";

type Brand = {
  erp_id: number;
  name: string | null;
  prefix: string | null;
};

type Article = {
  erp_id: number;
  code: string | null;
  particular_code: string | null;
  name: string | null;
  brand_id: number | null;
};

type Mapping = {
  id: number;
  supplier_name: string;
  supplier_code: string;
  article_erp_id: number;
  article_code: string;
  article_name: string | null;
  created_at: string;
  updated_at: string;
};

type ParsedItem = {
  supplierCode: string;
  description: string;
  quantity: number;
};

type ProcessResponse = {
  ok: boolean;
  fileName: string;
  totalPages: number;
  brand: {
    erpId: number;
    name: string | null;
    prefix: string | null;
  };
  parser: string;
  items: ParsedItem[];
  message?: string;
};

type ResolvedItem = ParsedItem & {
  article: Article | null;
  status: "matched" | "mapped" | "missing";
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function sanitizePostgrestValue(value: string) {
  return value
    .replaceAll(",", " ")
    .replaceAll("(", " ")
    .replaceAll(")", " ")
    .trim();
}

function normalizeSupplierCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function canonicalSupplierCode(value: string) {
  const normalized = normalizeSupplierCode(value);

  // Defensa extra para facturas ZF/SACHS:
  // si por cualquier motivo llega "315 563 CHEVROLET",
  // nos quedamos solamente con el código real "315 563".
  const zfMatch = normalized.match(/\b(\d{3})\s+(\d{3})\b/);

  if (zfMatch) {
    return `${zfMatch[1]} ${zfMatch[2]}`;
  }

  return normalized;
}

function supplierCodeCompact(value: string) {
  return canonicalSupplierCode(value).replace(/[\s-]+/g, "");
}

function buildExpectedTdCode(prefix: string, supplierCode: string) {
  const normalized = canonicalSupplierCode(supplierCode)
    .replace(new RegExp(`^${prefix}-?`, "i"), "")
    .trim();

  return `${prefix}-${normalized}`;
}


function consolidateStockRows(items: ResolvedItem[]) {
  const byCode = new Map<string, number>();

  for (const item of items) {
    const code = item.article?.code?.trim();

    if (!code) continue;

    byCode.set(code, (byCode.get(code) ?? 0) + Number(item.quantity || 0));
  }

  return Array.from(byCode.entries())
    .map(([code, quantity]) => ({
      Codigo: code,
      Cantidad: Number(quantity.toFixed(3)),
    }))
    .sort((a, b) =>
      a.Codigo.localeCompare(b.Codigo, "es", {
        numeric: true,
        sensitivity: "base",
      })
    );
}

export default function StockPage() {
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loggedUsername, setLoggedUsername] = useState("");

  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>(["", "", "", "", "", ""]);
  const [loadingBrands, setLoadingBrands] = useState(false);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [processingPdf, setProcessingPdf] = useState(false);
  const [processResult, setProcessResult] = useState<ProcessResponse | null>(null);
  const [resolvedItems, setResolvedItems] = useState<ResolvedItem[]>([]);

  const [manualIndex, setManualIndex] = useState<number | null>(null);
  const [articleSearch, setArticleSearch] = useState("");
  const [articleSuggestions, setArticleSuggestions] = useState<Article[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [searchAllArticles, setSearchAllArticles] = useState(false);
  const [searchingArticles, setSearchingArticles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingExcel, setGeneratingExcel] = useState(false);

  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedBrands = useMemo(
    () =>
      selectedBrandIds
        .map((id) => brands.find((brand) => String(brand.erp_id) === id) ?? null)
        .filter((brand): brand is Brand => brand !== null),
    [brands, selectedBrandIds]
  );

  const primaryBrand = selectedBrands[0] ?? null;

  const selectedBrandErpIds = useMemo(
    () => selectedBrands.map((brand) => brand.erp_id),
    [selectedBrands]
  );

  const selectedPrefixes = useMemo(
    () =>
      selectedBrands
        .map((brand) => brand.prefix?.trim() ?? "")
        .filter(Boolean),
    [selectedBrands]
  );

  const selectedBrandSummary = useMemo(
    () =>
      selectedBrands
        .map((brand) => `${brand.prefix ?? "?"} - ${brand.name ?? `Marca ${brand.erp_id}`}`)
        .join(" · "),
    [selectedBrands]
  );

  const missingCount = resolvedItems.filter(
    (item) => item.status === "missing"
  ).length;

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    const value = articleSearch.trim();

    if (manualIndex === null || selectedArticle || value.length < 2) {
      setArticleSuggestions([]);
      return;
    }

    const timeout = setTimeout(() => {
      void searchArticles(value);
    }, 250);

    return () => clearTimeout(timeout);
  }, [
    articleSearch,
    selectedArticle,
    selectedBrandIds,
    searchAllArticles,
    manualIndex,
  ]);

  async function loadInitialData() {
    await Promise.all([
      loadLastSync(),
      loadLoggedUser(),
      loadBrands(),
      loadMappings(),
    ]);
  }

  async function loadLastSync() {
    const { data, error } = await supabase
      .from("sync_status")
      .select("last_completed_at,success")
      .eq("sync_name", "sincronizacion_incremental")
      .maybeSingle();

    if (error || !data?.success) {
      setLastSync(null);
      return;
    }

    setLastSync(data.last_completed_at ?? null);
  }

  async function loadLoggedUser() {
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) {
      setLoggedUsername("");
      return;
    }

    const metadataName =
      typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name.trim()
        : "";

    setLoggedUsername(metadataName || user.email || "Usuario");
  }

  async function loadBrands() {
    setLoadingBrands(true);

    const { data, error } = await supabase
      .from("brands")
      .select("erp_id,name,prefix")
      .order("prefix", { ascending: true });

    if (error) {
      setError(`No se pudieron cargar las marcas: ${error.message}`);
      setBrands([]);
      setLoadingBrands(false);
      return;
    }

    setBrands((data ?? []) as Brand[]);
    setLoadingBrands(false);
  }

  async function loadMappings() {
    setLoadingMappings(true);

    const { data, error } = await supabase
      .from("supplier_article_mappings")
      .select(`
        id,
        supplier_name,
        supplier_code,
        article_erp_id,
        article_code,
        article_name,
        created_at,
        updated_at
      `)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      setMappings([]);
      setLoadingMappings(false);
      return;
    }

    setMappings((data ?? []) as Mapping[]);
    setLoadingMappings(false);
  }

  function resetInvoice() {
    setPdfFile(null);
    setProcessResult(null);
    setResolvedItems([]);
    closeManual();
    setError(null);
    setMessage(null);
  }

  function handleBrandChange(slotIndex: number, value: string) {
    setSelectedBrandIds((current) => {
      const next = [...current];

      // Evitamos repetir la misma familia en dos desplegables.
      if (
        value &&
        next.some((selectedId, index) => index !== slotIndex && selectedId === value)
      ) {
        setError("Esa marca / familia ya está seleccionada.");
        return current;
      }

      next[slotIndex] = value;

      // Si se borra la marca principal, también limpiamos las opcionales.
      if (slotIndex === 0 && !value) {
        return ["", "", "", "", "", ""];
      }

      return next;
    });

    resetInvoice();
  }

  async function handlePdfChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    setError(null);
    setMessage(null);
    setProcessResult(null);
    setResolvedItems([]);
    closeManual();

    if (selectedBrands.length === 0) {
      setError("Primero seleccioná al menos una marca / familia TD.");
      event.target.value = "";
      return;
    }

    if (!file) {
      setPdfFile(null);
      return;
    }

    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("El archivo debe ser un PDF.");
      event.target.value = "";
      return;
    }

    setPdfFile(file);
    await processPdf(file);
  }

  async function processPdf(file: File) {
    if (!primaryBrand) return;

    setProcessingPdf(true);
    setError(null);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      // La API necesita una marca de referencia para validar el pedido.
      // El matching real se hace luego contra TODAS las familias seleccionadas.
      formData.append("brandErpId", String(primaryBrand.erp_id));
      formData.append("brandName", primaryBrand.name ?? "");
      formData.append("brandPrefix", primaryBrand.prefix ?? "");
      formData.append(
        "selectedBrands",
        JSON.stringify(
          selectedBrands.map((brand) => ({
            erpId: brand.erp_id,
            name: brand.name,
            prefix: brand.prefix,
          }))
        )
      );

      const response = await fetch("/api/stock/procesar-pdf", {
        method: "POST",
        body: formData,
      });

      const contentType = response.headers.get("content-type") ?? "";

      if (!contentType.includes("application/json")) {
        const body = await response.text();
        throw new Error(
          response.status === 404
            ? "No existe la API /api/stock/procesar-pdf."
            : body || "La API devolvió una respuesta no válida."
        );
      }

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "No se pudo procesar la factura."
        );
      }

      const parsed = payload as ProcessResponse;
      setProcessResult(parsed);

      const resolved = await resolveItems(parsed.items);
      setResolvedItems(resolved);

      const missing = resolved.filter((item) => item.status === "missing").length;

      if (missing === 0) {
        setMessage(
          `Factura procesada: ${resolved.length} artículo(s) reconocidos automáticamente.`
        );
      } else {
        setError(
          `Factura procesada. Se reconocieron ${resolved.length - missing} artículo(s) y ${missing} necesitan revisión manual.`
        );
      }
    } catch (processError) {
      console.error("Error procesando PDF:", processError);
      setError(
        processError instanceof Error
          ? processError.message
          : "No se pudo procesar la factura."
      );
    } finally {
      setProcessingPdf(false);
    }
  }

  async function resolveItems(items: ParsedItem[]): Promise<ResolvedItem[]> {
    if (selectedBrands.length === 0) return [];

    const mappingNames = selectedBrands.map(
      (brand) => brand.name ?? `Marca ${brand.erp_id}`
    );

    const { data: savedMappings } = await supabase
      .from("supplier_article_mappings")
      .select(
        "supplier_name,supplier_code,article_erp_id,article_code,article_name"
      )
      .in("supplier_name", mappingNames);

    const savedByCode = new Map<
      string,
      {
        supplier_name: string;
        supplier_code: string;
        article_erp_id: number;
        article_code: string;
        article_name: string | null;
      }
    >();

    for (const row of savedMappings ?? []) {
      const key = supplierCodeCompact(String(row.supplier_code));

      // Si hubiera más de una equivalencia para el mismo código entre las
      // familias elegidas, respetamos el orden de los desplegables.
      const rowPriority = mappingNames.indexOf(String(row.supplier_name));
      const current = savedByCode.get(key);

      if (!current) {
        savedByCode.set(key, row);
        continue;
      }

      const currentPriority = mappingNames.indexOf(String(current.supplier_name));

      if (
        rowPriority >= 0 &&
        (currentPriority < 0 || rowPriority < currentPriority)
      ) {
        savedByCode.set(key, row);
      }
    }

    const result: ResolvedItem[] = [];

    for (const item of items) {
      const compactCode = supplierCodeCompact(item.supplierCode);
      const saved = savedByCode.get(compactCode);

      if (saved) {
        result.push({
          ...item,
          article: {
            erp_id: Number(saved.article_erp_id),
            code: String(saved.article_code),
            particular_code: null,
            name: saved.article_name ? String(saved.article_name) : null,
            brand_id: null,
          },
          status: "mapped",
        });
        continue;
      }

      let foundArticle: Article | null = null;

      // Intento 1: código exacto construyendo prefijo + código factura
      // para cada una de las familias seleccionadas, en orden.
      for (const brand of selectedBrands) {
        const prefix = brand.prefix?.trim() ?? "";
        if (!prefix) continue;

        const expectedCode = buildExpectedTdCode(prefix, item.supplierCode);

        const { data: exact } = await supabase
          .from("articles")
          .select("erp_id,code,particular_code,name,brand_id")
          .eq("code", expectedCode)
          .limit(1)
          .maybeSingle();

        if (exact) {
          foundArticle = exact as Article;
          break;
        }
      }

      if (foundArticle) {
        result.push({
          ...item,
          article: foundArticle,
          status: "matched",
        });
        continue;
      }

      // Intento 2: tolerante a espacios/formato, pero SOLO dentro de las
      // familias que el usuario eligió.
      for (const brand of selectedBrands) {
        const prefix = brand.prefix?.trim() ?? "";
        if (!prefix) continue;

        const codeTail = canonicalSupplierCode(item.supplierCode)
          .replace(new RegExp(`^${prefix}-?`, "i"), "")
          .trim();

        const { data: candidates } = await supabase
          .from("articles")
          .select("erp_id,code,particular_code,name,brand_id")
          .eq("brand_id", brand.erp_id)
          .like("code", `${prefix}-%${codeTail.replaceAll(" ", "%")}%`)
          .limit(20);

        const normalizedCandidate = (candidates ?? []).find((candidate) => {
          const candidateCode = supplierCodeCompact(
            String(candidate.code ?? "")
          ).replace(new RegExp(`^${prefix}`), "");

          return candidateCode === compactCode;
        });

        if (normalizedCandidate) {
          foundArticle = normalizedCandidate as Article;
          break;
        }
      }

      if (foundArticle) {
        result.push({
          ...item,
          article: foundArticle,
          status: "matched",
        });
      } else {
        result.push({ ...item, article: null, status: "missing" });
      }
    }

    return result;
  }

  async function searchArticles(value: string) {
    if (selectedBrands.length === 0) return;

    setSearchingArticles(true);

    const safeValue = sanitizePostgrestValue(value);
    const numericValue = Number(safeValue);

    const filters = [
      `code.ilike.%${safeValue}%`,
      `particular_code.ilike.%${safeValue}%`,
      `name.ilike.%${safeValue}%`,
    ];

    if (!Number.isNaN(numericValue)) {
      filters.push(`erp_id.eq.${numericValue}`);
    }

    let query = supabase
      .from("articles")
      .select("erp_id,code,particular_code,name,brand_id")
      .or(filters.join(","));

    if (!searchAllArticles && selectedBrandErpIds.length > 0) {
      query = query.in("brand_id", selectedBrandErpIds);
    }

    const { data, error } = await query
      .order("erp_id", { ascending: true })
      .limit(20);

    if (error) {
      setArticleSuggestions([]);
      setSearchingArticles(false);
      setError(`No se pudieron buscar artículos: ${error.message}`);
      return;
    }

    setArticleSuggestions((data ?? []) as Article[]);
    setSearchingArticles(false);
  }

  function openManual(index: number) {
    const item = resolvedItems[index];
    setManualIndex(index);
    setArticleSearch(item.supplierCode);
    setSelectedArticle(null);
    setArticleSuggestions([]);
    setSearchAllArticles(false);
    setError(null);
  }

  function closeManual() {
    setManualIndex(null);
    setArticleSearch("");
    setSelectedArticle(null);
    setArticleSuggestions([]);
    setSearchAllArticles(false);
  }

  async function saveMapping() {
    if (selectedBrands.length === 0 || manualIndex === null) return;

    const item = resolvedItems[manualIndex];

    if (!selectedArticle?.code) {
      setError("Seleccioná el artículo TD correcto.");
      return;
    }

    setSaving(true);
    setError(null);

    const mappingBrand =
      selectedBrands.find(
        (brand) => brand.erp_id === selectedArticle.brand_id
      ) ?? primaryBrand;

    if (!mappingBrand) {
      setSaving(false);
      setError("No se pudo determinar la familia TD de la equivalencia.");
      return;
    }

    const mappingName =
      mappingBrand.name ?? `Marca ${mappingBrand.erp_id}`;

    const { error } = await supabase
      .from("supplier_article_mappings")
      .upsert(
        {
          supplier_name: mappingName,
          supplier_code: canonicalSupplierCode(item.supplierCode),
          article_erp_id: selectedArticle.erp_id,
          article_code: selectedArticle.code,
          article_name: selectedArticle.name,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "supplier_name,supplier_code",
        }
      );

    if (error) {
      setSaving(false);
      setError(`No se pudo guardar la equivalencia: ${error.message}`);
      return;
    }

    setResolvedItems((current) =>
      current.map((row, index) =>
        index === manualIndex
          ? {
              ...row,
              article: selectedArticle,
              status: "mapped",
            }
          : row
      )
    );

    setSaving(false);
    setMessage(
      `${item.supplierCode} quedó asociado a ${selectedArticle.code}. La próxima vez será automático.`
    );
    closeManual();
    await loadMappings();
  }

  async function generateStockExcel() {
    if (resolvedItems.length === 0) {
      setError("No hay artículos para exportar.");
      return;
    }

    if (missingCount > 0) {
      setError(
        `Todavía hay ${missingCount} artículo(s) sin resolver. Asociálos antes de generar el Excel.`
      );
      return;
    }

    const rows = consolidateStockRows(resolvedItems);

    if (rows.length === 0) {
      setError("No hay códigos TD válidos para exportar.");
      return;
    }

    setGeneratingExcel(true);
    setError(null);
    setMessage(null);

    try {
      const XLSX = await import("xlsx");

      /*
       * IMPORTANTE:
       * El archivo para importar stock al SaaS-ERP queda solamente con:
       *
       *   Codigo | Cantidad
       *
       * No agregamos descripción, marca ni columnas auxiliares para no alterar
       * el formato de importación.
       */
      const worksheet = XLSX.utils.json_to_sheet(rows, {
        header: ["Codigo", "Cantidad"],
      });

      // Forzamos Código como texto para conservar guiones y espacios.
      for (let row = 2; row <= rows.length + 1; row += 1) {
        const codeCell = worksheet[`A${row}`];

        if (codeCell) {
          codeCell.t = "s";
          codeCell.v = String(codeCell.v ?? "");
        }

        const quantityCell = worksheet[`B${row}`];

        if (quantityCell) {
          quantityCell.t = "n";
          quantityCell.v = Number(quantityCell.v ?? 0);
        }
      }

      worksheet["!cols"] = [
        { wch: 22 },
        { wch: 12 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Stock");

      XLSX.writeFile(workbook, "Stock.xlsx", {
        compression: true,
      });

      const totalUnits = rows.reduce(
        (sum, row) => sum + Number(row.Cantidad || 0),
        0
      );

      setMessage(
        `Stock.xlsx generado correctamente: ${rows.length} código(s) y ${Number(
          totalUnits.toFixed(3)
        )} unidad(es).`
      );
    } catch (excelError) {
      console.error("Error generando Stock.xlsx:", excelError);

      setError(
        excelError instanceof Error
          ? `No se pudo generar Stock.xlsx: ${excelError.message}`
          : "No se pudo generar Stock.xlsx."
      );
    } finally {
      setGeneratingExcel(false);
    }
  }

  async function deleteMapping(mapping: Mapping) {
    const confirmed = window.confirm(
      `¿Eliminar la equivalencia ${mapping.supplier_code} → ${mapping.article_code}?`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("supplier_article_mappings")
      .delete()
      .eq("id", mapping.id);

    if (error) {
      setError(`No se pudo eliminar: ${error.message}`);
      return;
    }

    setMessage("Equivalencia eliminada.");
    await loadMappings();
  }

  return (
    <main className="min-h-screen bg-slate-50 text-gray-900">
      <div className="h-1.5 w-full bg-red-700" />

      <header className="border-b bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <NavigationLoadingLink
              href="/clientes"
              loadingText="Volviendo a clientes..."
              className="flex h-16 w-40 shrink-0 items-center justify-center sm:h-20 sm:w-48"
            >
              <Image
                src="/logo.jpg"
                alt="La Casa del Tren Delantero"
                width={220}
                height={90}
                priority
                className="h-auto max-h-full w-auto object-contain"
              />
            </NavigationLoadingLink>

            <div className="hidden border-l border-gray-200 pl-4 sm:block">
              <h1 className="text-xl font-bold text-gray-900 lg:text-2xl">
                Carga de stock
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Elegí la marca, subí la factura y revisá solo lo que no coincida.
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <NavigationLoadingLink
              href="/historico-articulos"
              loadingText="Abriendo histórico..."
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              Histórico
            </NavigationLoadingLink>

            <NavigationLoadingLink
              href="/clientes"
              loadingText="Volviendo a clientes..."
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              Clientes
            </NavigationLoadingLink>

            <LogoutButton />

            {loggedUsername && (
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-sm font-extrabold uppercase text-red-700">
                  {loggedUsername.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium leading-none text-gray-400">
                    Usuario
                  </p>
                  <p className="mt-1 max-w-[130px] truncate text-sm font-bold leading-none text-gray-900">
                    {loggedUsername}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
              <div>
                <p className="text-xs font-medium text-gray-500">
                  Última sincronización
                </p>
                <p className="mt-0.5 whitespace-nowrap text-sm font-semibold text-gray-900">
                  {lastSync ? formatDateTime(lastSync) : "Sin información"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {(error || message) && (
          <div
            className={`mb-6 flex items-start gap-3 rounded-2xl border px-5 py-4 text-sm font-medium ${
              error
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-green-200 bg-green-50 text-green-800"
            }`}
          >
            {error ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <span>{error ?? message}</span>
          </div>
        )}

        <section className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="font-semibold text-gray-900">
              1. Seleccioná la marca / familia
            </h2>
            <p className="text-sm text-gray-500">
              Podés elegir hasta 6 familias. La primera es obligatoria y las otras cinco son opcionales.
              El sistema probará los prefijos en ese orden.
            </p>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((slotIndex) => {
              const selectedId = selectedBrandIds[slotIndex];
              const selected = selectedBrands.find(
                (brand) => String(brand.erp_id) === selectedId
              );

              return (
                <div key={slotIndex}>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    {slotIndex === 0
                      ? "Marca principal"
                      : `Marca opcional ${slotIndex + 1}`}
                  </label>

                  <select
                    value={selectedId}
                    onChange={(event) =>
                      handleBrandChange(slotIndex, event.target.value)
                    }
                    disabled={
                      loadingBrands ||
                      (slotIndex > 0 && !selectedBrandIds[0])
                    }
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    <option value="">
                      {loadingBrands
                        ? "Cargando marcas..."
                        : slotIndex === 0
                          ? "Seleccionar marca"
                          : "Sin marca opcional"}
                    </option>

                    {brands.map((brand) => {
                      const brandId = String(brand.erp_id);
                      const selectedElsewhere = selectedBrandIds.some(
                        (id, index) => index !== slotIndex && id === brandId
                      );

                      return (
                        <option
                          key={brand.erp_id}
                          value={brand.erp_id}
                          disabled={selectedElsewhere}
                        >
                          {brand.prefix ? `${brand.prefix} - ` : ""}
                          {brand.name ?? `Marca ${brand.erp_id}`}
                        </option>
                      );
                    })}
                  </select>

                  {selected && (
                    <p className="mt-2 text-sm text-gray-600">
                      Prefijo TD:{" "}
                      <span className="font-mono font-bold text-red-700">
                        {selected.prefix ?? "sin prefijo"}-
                      </span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {selectedBrands.length > 1 && (
            <div className="border-t border-gray-100 bg-gray-50 px-5 py-3 text-sm text-gray-600">
              Se buscará en:{" "}
              <span className="font-semibold text-gray-900">
                {selectedBrandSummary}
              </span>
            </div>
          )}
        </section>

        <section
          className={`mb-6 overflow-hidden rounded-2xl border bg-white shadow-sm ${
            selectedBrands.length > 0 ? "border-gray-200" : "border-gray-200 opacity-60"
          }`}
        >
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="font-semibold text-gray-900">
              2. Subí la factura PDF
            </h2>
            <p className="text-sm text-gray-500">
              Al elegir el archivo se procesa automáticamente.
            </p>
          </div>

          <div className="p-5">
            <label
              className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
                selectedBrands.length > 0
                  ? "cursor-pointer border-gray-300 bg-gray-50 hover:border-red-300 hover:bg-red-50/40"
                  : "cursor-not-allowed border-gray-200 bg-gray-50"
              }`}
            >
              {processingPdf ? (
                <Loader2 className="mb-3 h-8 w-8 animate-spin text-red-700" />
              ) : (
                <Upload className="mb-3 h-8 w-8 text-red-700" />
              )}

              <span className="font-bold text-gray-900">
                {processingPdf
                  ? "Procesando factura..."
                  : pdfFile
                    ? pdfFile.name
                    : "Seleccionar factura PDF"}
              </span>

              <span className="mt-1 text-sm text-gray-500">
                {selectedBrands.length > 0
                  ? selectedBrandSummary
                  : "Primero seleccioná al menos una marca"}
              </span>

              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={handlePdfChange}
                disabled={selectedBrands.length === 0 || processingPdf}
                className="hidden"
              />
            </label>

            {pdfFile && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-red-700" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-gray-900">
                      {pdfFile.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {(pdfFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={resetInvoice}
                  className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Quitar PDF"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </section>

        {resolvedItems.length > 0 && (
          <section className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="font-semibold text-gray-900">
                  3. Artículos detectados
                </h2>
                <p className="text-sm text-gray-500">
                  {resolvedItems.length} artículo(s) ·{" "}
                  {missingCount === 0
                    ? "todos reconocidos"
                    : `${missingCount} para revisar`}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void generateStockExcel()}
                disabled={
                  missingCount > 0 ||
                  resolvedItems.length === 0 ||
                  generatingExcel
                }
                title={
                  missingCount > 0
                    ? "Primero resolvé todos los artículos pendientes"
                    : "Generar archivo de importación de stock"
                }
                className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none"
              >
                {generatingExcel ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                {generatingExcel ? "Generando..." : "Generar Stock.xlsx"}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-3 font-bold">Código factura</th>
                    <th className="px-5 py-3 font-bold">Descripción</th>
                    <th className="px-5 py-3 text-right font-bold">Cantidad</th>
                    <th className="px-5 py-3 font-bold">Código TD</th>
                    <th className="px-5 py-3 font-bold">Familia TD</th>
                    <th className="px-5 py-3 font-bold">Estado</th>
                    <th className="px-5 py-3 text-right font-bold">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {resolvedItems.map((item, index) => (
                    <tr key={`${item.supplierCode}-${index}`}>
                      <td className="px-5 py-3 font-mono font-bold">
                        {item.supplierCode}
                      </td>
                      <td className="max-w-md px-5 py-3 text-gray-600">
                        {item.description}
                      </td>
                      <td className="px-5 py-3 text-right font-bold">
                        {item.quantity}
                      </td>
                      <td className="px-5 py-3 font-mono font-bold text-red-700">
                        {item.article?.code ?? "-"}
                      </td>
                      <td className="px-5 py-3 text-gray-600">
                        {item.article?.code
                          ? selectedBrands.find(
                              (brand) =>
                                item.article?.code?.startsWith(
                                  `${brand.prefix ?? ""}-`
                                )
                            )?.name ?? "-"
                          : "-"}
                      </td>
                      <td className="px-5 py-3">
                        {item.status === "missing" ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                            Revisar
                          </span>
                        ) : (
                          <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-800">
                            {item.status === "mapped"
                              ? "Aprendido"
                              : "Encontrado"}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {item.status === "missing" && (
                          <button
                            type="button"
                            onClick={() => openManual(index)}
                            className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-100"
                          >
                            Asociar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {manualIndex !== null && (
          <section className="mb-6 overflow-visible rounded-2xl border border-amber-200 bg-white shadow-sm">
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-4">
              <h2 className="font-semibold text-amber-900">
                Asociar código manualmente
              </h2>
              <p className="mt-1 text-sm text-amber-800">
                Código de factura:{" "}
                <strong>{resolvedItems[manualIndex].supplierCode}</strong>.
                Esta asociación queda guardada para la próxima vez.
              </p>
            </div>

            <div className="grid gap-5 p-5 xl:grid-cols-[1fr_auto] xl:items-end">
              <div className="relative">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Artículo TD correcto
                </label>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    value={articleSearch}
                    onChange={(event) => {
                      setArticleSearch(event.target.value);
                      setSelectedArticle(null);
                    }}
                    placeholder={`Buscar dentro de ${selectedPrefixes.join(", ") || "las familias"}...`}
                    className="w-full rounded-xl border border-gray-300 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
                  />
                </div>

                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-600">
                  <input
                    type="checkbox"
                    checked={searchAllArticles}
                    onChange={(event) => {
                      setSearchAllArticles(event.target.checked);
                      setSelectedArticle(null);
                      setArticleSuggestions([]);
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-red-700 focus:ring-red-500"
                  />
                  Buscar en todo TD si no aparece en las familias seleccionadas
                </label>

                {selectedArticle && (
                  <div className="mt-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2">
                    <p className="text-sm font-bold text-green-900">
                      {selectedArticle.code ?? `ID ${selectedArticle.erp_id}`}
                    </p>
                    <p className="mt-0.5 text-xs text-green-700">
                      {selectedArticle.name ?? "Sin descripción"}
                    </p>
                  </div>
                )}

                {!selectedArticle && articleSearch.trim().length >= 2 && (
                  <div className="absolute z-20 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-xl">
                    {searchingArticles ? (
                      <div className="px-4 py-3 text-sm text-gray-500">
                        Buscando artículos...
                      </div>
                    ) : articleSuggestions.length > 0 ? (
                      articleSuggestions.map((article) => (
                        <button
                          key={article.erp_id}
                          type="button"
                          onClick={() => {
                            setSelectedArticle(article);
                            setArticleSearch(
                              article.code ??
                                article.name ??
                                String(article.erp_id)
                            );
                            setArticleSuggestions([]);
                          }}
                          className="block w-full border-b border-gray-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-red-50"
                        >
                          <p className="text-sm font-bold text-gray-900">
                            {article.code ?? "Sin código"}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {article.name ?? "Sin descripción"}
                          </p>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-gray-500">
                        No se encontraron artículos.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeManual}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={saveMapping}
                  disabled={saving || !selectedArticle}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 disabled:opacity-50"
                >
                  <Link2 className="h-4 w-4" />
                  {saving ? "Guardando..." : "Guardar equivalencia"}
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <h2 className="font-semibold text-gray-900">
                Equivalencias aprendidas
              </h2>
              <p className="text-sm text-gray-500">
                Se aplican automáticamente a futuras facturas.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadMappings()}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
            >
              Actualizar
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3 font-bold">Marca / familia</th>
                  <th className="px-5 py-3 font-bold">Código factura</th>
                  <th className="px-5 py-3 font-bold">Código TD</th>
                  <th className="px-5 py-3 font-bold">Artículo</th>
                  <th className="px-5 py-3 font-bold">Actualizado</th>
                  <th className="px-5 py-3 text-right font-bold">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loadingMappings ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-gray-500">
                      Cargando equivalencias...
                    </td>
                  </tr>
                ) : mappings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-gray-500">
                      Todavía no hay equivalencias guardadas.
                    </td>
                  </tr>
                ) : (
                  mappings.map((mapping) => (
                    <tr key={mapping.id}>
                      <td className="px-5 py-3 font-bold">
                        {mapping.supplier_name}
                      </td>
                      <td className="px-5 py-3 font-mono font-bold">
                        {mapping.supplier_code}
                      </td>
                      <td className="px-5 py-3 font-mono font-bold text-red-700">
                        {mapping.article_code}
                      </td>
                      <td className="max-w-md px-5 py-3 text-gray-600">
                        {mapping.article_name ?? "Sin descripción"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-gray-500">
                        {formatDateTime(mapping.updated_at)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void deleteMapping(mapping)}
                          className="rounded-lg px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
