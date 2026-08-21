import Image from "next/image";

import { createClient } from "@/lib/supabase/server";
import NavigationLoadingLink from "@/components/NavigationLoadingLink";

type PageProps = {
  params: Promise<{
    erp_id: string;
    receipt_id: string;
  }>;

  searchParams: Promise<{
    from?: string | string[];
  }>;
};

function formatDateTime(
  value: string | null | undefined
) {
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

function formatMoney(
  value: number | string | null | undefined
) {
  if (value == null) return "-";

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function getReceiptInfo(
  documentType: number | null | undefined
) {
  if (Number(documentType) === 67) {
    return {
      name: "Recibo 2",
      abbreviation: "RECX",
    };
  }

  return {
    name: "Recibo",
    abbreviation: "REC",
  };
}

function getSafeReturnUrl(
  value: string | string[] | undefined,
  customerId: string
) {
  const rawValue =
    Array.isArray(value)
      ? value[0]
      : value;

  /*
   * Solo aceptamos rutas internas.
   * Si no existe `from`, volvemos al cliente.
   */
  if (
    rawValue &&
    rawValue.startsWith("/") &&
    !rawValue.startsWith("//")
  ) {
    return rawValue;
  }

  return `/clientes/${customerId}`;
}

export default async function ReceiptPage({
  params,
  searchParams,
}: PageProps) {
  /*
   * =========================================================
   * SUPABASE AUTENTICADO
   * =========================================================
   */

  const supabase = await createClient();

  const { erp_id, receipt_id } = await params;
  const resolvedSearchParams =
    await searchParams;

  const customerId = Number(erp_id);
  const receiptId = Number(receipt_id);

  /*
   * =========================================================
   * URL DE REGRESO
   * =========================================================
   *
   * Desde el histórico llegamos con algo como:
   *
   * /recibos/60775?from=%2Fhistorico-articulos%3FdocumentType...
   *
   * Recuperamos esa URL para que "Volver" conserve:
   * - artículo
   * - cliente
   * - tipo de comprobante
   * - número
   * - fechas
   * - página
   */

  const backHref = getSafeReturnUrl(
    resolvedSearchParams.from,
    erp_id
  );

  const cameFromHistory =
    backHref.startsWith(
      "/historico-articulos"
    );

  const backText =
    cameFromHistory
      ? "Volver al histórico"
      : "Volver al cliente";

  const backLoadingText =
    cameFromHistory
      ? "Volviendo al histórico..."
      : "Volviendo al cliente...";

  /*
   * =========================================================
   * RECIBO
   * =========================================================
   */

  const {
    data: receipt,
    error: receiptError,
  } = await supabase
    .from("receipts")
    .select(`
      erp_id,
      customer_id,
      number,
      issued_at,
      amount,
      observations,
      document_type
    `)
    .eq("erp_id", receiptId)
    .eq("customer_id", customerId)
    .maybeSingle();

  /*
   * =========================================================
   * CLIENTE
   * =========================================================
   */

  const {
    data: customer,
    error: customerError,
  } = await supabase
    .from("customers")
    .select(`
      business_name,
      name
    `)
    .eq("erp_id", customerId)
    .maybeSingle();

  if (customerError) {
    console.error(
      "Error cargando cliente del recibo:",
      customerError
    );
  }

  /*
   * =========================================================
   * ÚLTIMA SINCRONIZACIÓN
   * =========================================================
   */

  const {
    data: syncStatus,
    error: syncStatusError,
  } = await supabase
    .from("sync_status")
    .select(`
      last_completed_at,
      success
    `)
    .eq(
      "sync_name",
      "sincronizacion_incremental"
    )
    .maybeSingle();

  if (syncStatusError) {
    console.error(
      "Error cargando última sincronización:",
      syncStatusError
    );
  }

  const lastSync =
    syncStatus?.success === true
      ? syncStatus.last_completed_at
      : null;

  /*
   * =========================================================
   * ERROR
   * =========================================================
   */

  if (receiptError || !receipt) {
    return (
      <main className="min-h-screen bg-slate-50 text-gray-900">
        <div className="h-1.5 w-full bg-red-700" />

        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <NavigationLoadingLink
            href={backHref}
            loadingText={backLoadingText}
            className="text-sm font-semibold text-gray-600 transition hover:text-red-700"
          >
            ← {backText}
          </NavigationLoadingLink>

          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-sm">
            <p className="font-semibold">
              No se pudo encontrar el recibo.
            </p>

            {receiptError?.message && (
              <p className="mt-2 text-sm">
                {receiptError.message}
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  const customerName =
    customer?.business_name ||
    customer?.name ||
    `Cliente ${customerId}`;

  const receiptInfo =
    getReceiptInfo(
      receipt.document_type
    );

  /*
   * =========================================================
   * VISTA
   * =========================================================
   */

  return (
    <main className="min-h-screen bg-slate-50 text-gray-900">
      {/* BARRA ROJA */}

      <div className="h-1.5 w-full bg-red-700" />

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <NavigationLoadingLink
              href={backHref}
              loadingText={backLoadingText}
              className="flex h-14 w-36 shrink-0 items-center justify-center sm:h-16 sm:w-40"
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
                Detalle de recibo
              </h1>

              <p className="mt-1 text-sm text-gray-500">
                Visualizador TD
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 md:flex">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />

            <div>
              <p className="text-xs font-medium text-gray-500">
                Última sincronización
              </p>

              <p className="mt-0.5 whitespace-nowrap text-sm font-semibold text-gray-900">
                {lastSync
                  ? formatDateTime(lastSync)
                  : "Sin información"}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* =====================================================
          CONTENIDO
      ===================================================== */}

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <NavigationLoadingLink
          href={backHref}
          loadingText={backLoadingText}
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 transition hover:text-red-700"
        >
          ← {backText}
        </NavigationLoadingLink>

        {/* ===================================================
            RECIBO
        =================================================== */}

        <section className="mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-5 sm:p-7">
            <span className="inline-flex rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
              {receiptInfo.name}
            </span>

            <h2 className="mt-3 text-2xl font-bold text-gray-900 sm:text-3xl">
              {receiptInfo.abbreviation}-
              {receipt.number}
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              {customerName}
            </p>
          </div>

          <div className="grid gap-px bg-gray-100 sm:grid-cols-3">
            {/* FECHA */}

            <div className="bg-white p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Fecha y hora
              </p>

              <p className="mt-2 text-base font-bold text-gray-900">
                {formatDateTime(
                  receipt.issued_at
                )}
              </p>
            </div>

            {/* IMPORTE */}

            <div className="bg-white p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Importe
              </p>

              <p className="mt-2 text-xl font-extrabold text-green-700">
                {formatMoney(
                  receipt.amount
                )}
              </p>
            </div>

            {/* OBSERVACIÓN */}

            <div className="bg-white p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Observación
              </p>

              <p className="mt-2 whitespace-pre-wrap break-words text-base font-bold text-gray-900">
                {receipt.observations ||
                  "Sin observaciones"}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}