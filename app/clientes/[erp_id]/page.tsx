import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import MovementsTabs from "./MovementsTabs";

type PageProps = {
  params: Promise<{
    erp_id: string;
  }>;
};

type InvoiceInfo = {
  document_type: number;
  number: number | string | null;
};

function formatMoney(
  value: number | string | null | undefined
) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(Number(value ?? 0));
}

function formatCustomerCode(
  value: number | string | null | undefined
) {
  if (value === null || value === undefined) {
    return "-";
  }

  return String(value).padStart(5, "0");
}

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

function getDocumentPrefix(
  documentType: number | null | undefined
) {
  switch (Number(documentType)) {
    // CUENTA CORRIENTE
    case 1:
      return "FC";

    case 2:
      return "NC";

    case 6:
      return "ND";

    case 20:
      return "REC";

    // CUENTA 2 / PEDIDOS
    case 66:
      return "FCX";

    case 67:
      return "RECX";

    case 68:
      return "NCX";

    case 69:
      return "NDX";

    default:
      return "";
  }
}

function getBalanceText(balance: number) {
  if (balance > 0) return "Debe";
  if (balance < 0) return "A favor del cliente";

  return "Sin saldo pendiente";
}

function getBalanceClass(balance: number) {
  if (balance > 0) {
    return "text-red-700";
  }

  if (balance < 0) {
    return "text-green-700";
  }

  return "text-gray-900";
}

export default async function CustomerPage({
  params,
}: PageProps) {
  const supabase = await createClient();

  const { erp_id } = await params;

  const customerId = Number(erp_id);

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
    .select("*")
    .eq("erp_id", customerId)
    .single();

  /*
   * =========================================================
   * ERROR CLIENTE
   * =========================================================
   */

  if (customerError || !customer) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="h-1.5 w-full bg-red-700" />

        <header className="border-b bg-white shadow-sm">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex h-14 w-36 items-center justify-center sm:h-16 sm:w-40">
              <Image
                src="/logo.JPG"
                alt="La Casa del Tren Delantero"
                width={220}
                height={90}
                priority
                className="h-auto max-h-full w-auto object-contain"
              />
            </div>

            <div className="hidden border-l border-gray-200 pl-4 sm:block">
              <h1 className="text-xl font-bold text-gray-900">
                Visualizador de clientes
              </h1>

              <p className="text-sm text-gray-500">
                Información sincronizada desde TD
              </p>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Link
            href="/clientes"
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 transition hover:text-red-700"
          >
            ← Volver a clientes
          </Link>

          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-sm">
            <p className="font-semibold">
              No se pudo encontrar el cliente.
            </p>

            {customerError?.message && (
              <p className="mt-2 text-sm">
                {customerError.message}
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  /*
   * =========================================================
   * ÚLTIMA SINCRONIZACIÓN COMPLETA
   * =========================================================
   */

  const { data: syncStatus } = await supabase
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

  const lastSync =
    syncStatus?.success === true &&
    syncStatus?.last_completed_at
      ? syncStatus.last_completed_at
      : null;

  /*
   * =========================================================
   * MOVIMIENTOS
   * =========================================================
   */

  const {
    data: movements,
    error: movementsError,
  } = await supabase
    .from("account_movements")
    .select(`
      erp_id,
      customer_id,
      registered_at,
      due_at,
      document_type,
      document_id,
      debit,
      credit,
      balance,
      deleted
    `)
    .eq("customer_id", customerId)
    .eq("deleted", false)
    .order("registered_at", {
      ascending: false,
    });

  const safeMovements = movements ?? [];

  /*
   * =========================================================
   * IDS DE COMPROBANTES
   * =========================================================
   */

  const documentIds = Array.from(
    new Set(
      safeMovements
        .map((movement) =>
          Number(movement.document_id)
        )
        .filter(
          (id) =>
            Number.isFinite(id) &&
            id > 0
        )
    )
  );

  /*
   * =========================================================
   * COMPROBANTES / INVOICES
   * =========================================================
   */

  let invoices: {
    erp_id: number;
    document_type: number | null;
    number: number | string | null;
  }[] = [];

  let invoicesErrorMessage:
    | string
    | null = null;

  if (documentIds.length > 0) {
    const {
      data: invoicesData,
      error: invoicesError,
    } = await supabase
      .from("invoices")
      .select(`
        erp_id,
        document_type,
        number
      `)
      .in("erp_id", documentIds);

    if (invoicesError) {
      console.error(
        "Error al cargar invoices:",
        invoicesError
      );

      invoicesErrorMessage =
        invoicesError.message;
    } else {
      invoices = invoicesData ?? [];
    }
  }

  /*
   * =========================================================
   * MAPA DE COMPROBANTES
   * =========================================================
   */

  const invoiceMap = new Map<
    number,
    InvoiceInfo
  >();

  for (const invoice of invoices) {
    invoiceMap.set(
      Number(invoice.erp_id),
      {
        document_type: Number(
          invoice.document_type
        ),
        number: invoice.number,
      }
    );
  }

  /*
   * =========================================================
   * CUENTA CORRIENTE
   * =========================================================
   */

  const whiteDocumentTypes = [
    1,
    2,
    6,
    20,
  ];

  const whiteMovements =
    safeMovements.filter(
      (movement) =>
        whiteDocumentTypes.includes(
          Number(
            movement.document_type
          )
        )
    );

  const whiteBalance =
    whiteMovements.reduce(
      (total, movement) =>
        total +
        Number(
          movement.debit ?? 0
        ) -
        Number(
          movement.credit ?? 0
        ),
      0
    );

  /*
   * =========================================================
   * CUENTA 2 / PEDIDOS
   * =========================================================
   */

  const blackDocumentTypes = [
    66,
    67,
    68,
    69,
  ];

  const blackMovements =
    safeMovements.filter(
      (movement) =>
        blackDocumentTypes.includes(
          Number(
            movement.document_type
          )
        )
    );

  const blackBalance =
    blackMovements.reduce(
      (total, movement) =>
        total +
        Number(
          movement.debit ?? 0
        ) -
        Number(
          movement.credit ?? 0
        ),
      0
    );

  /*
   * =========================================================
   * NÚMERO VISIBLE DEL COMPROBANTE
   * =========================================================
   */

  function getDocumentNumber(
    documentId:
      | number
      | null
      | undefined,
    documentType:
      | number
      | null
      | undefined
  ) {
    if (
      documentId === null ||
      documentId === undefined
    ) {
      return "-";
    }

    const prefix =
      getDocumentPrefix(
        documentType
      );

    const invoice =
      invoiceMap.get(
        Number(documentId)
      );

    if (
      invoice &&
      invoice.number !== null &&
      invoice.number !== undefined
    ) {
      return prefix
        ? `${prefix}-${invoice.number}`
        : String(invoice.number);
    }

    return prefix
      ? `${prefix} (ID ${documentId})`
      : `ID ${documentId}`;
  }

  /*
   * =========================================================
   * NÚMEROS PARA MOVEMENTSTABS
   * =========================================================
   */

  const documentNumbers: Record<
    string,
    string
  > = {};

  for (const movement of safeMovements) {
    documentNumbers[
      String(movement.erp_id)
    ] = getDocumentNumber(
      movement.document_id,
      movement.document_type
    );
  }

  /*
   * =========================================================
   * DATOS AUXILIARES
   * =========================================================
   */

  const customerName =
    customer.business_name ||
    customer.name ||
    "Sin nombre";

  /*
   * =========================================================
   * PANTALLA
   * =========================================================
   */

  return (
    <main className="min-h-screen bg-slate-50">
      {/* =====================================================
          BARRA SUPERIOR
      ===================================================== */}

      <div className="h-1.5 w-full bg-red-700" />

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            {/* LOGO */}

            <Link
              href="/clientes"
              className="flex h-14 w-36 shrink-0 items-center justify-center sm:h-16 sm:w-40"
            >
              <Image
                src="/logo.JPG"
                alt="La Casa del Tren Delantero"
                width={220}
                height={90}
                priority
                className="h-auto max-h-full w-auto object-contain"
              />
            </Link>

            {/* TÍTULO */}

            <div className="hidden border-l border-gray-200 pl-4 sm:block">
              <h1 className="text-xl font-bold text-gray-900 lg:text-2xl">
                Detalle de cliente
              </h1>

              <p className="mt-1 text-sm text-gray-500">
                Visualizador TD
              </p>
            </div>
          </div>

          {/* ÚLTIMA SINCRONIZACIÓN */}

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

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* VOLVER */}

        <Link
          href="/clientes"
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 transition hover:text-red-700"
        >
          <span>←</span>
          Volver a clientes
        </Link>

        {/* ===================================================
            CABECERA CLIENTE
        =================================================== */}

        <section className="mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-5 sm:px-6 lg:px-8 lg:py-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
                    Cliente{" "}
                    {formatCustomerCode(
                      customer.erp_id
                    )}
                  </span>

                  {customer.zone && (
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                      Zona {customer.zone}
                    </span>
                  )}
                </div>

                <h1 className="mt-3 break-words text-2xl font-bold leading-tight text-gray-900 sm:text-3xl">
                  {customerName}
                </h1>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                  {customer.locality_name && (
                    <span>
                      {customer.locality_name}
                    </span>
                  )}

                  {customer.cuit && (
                    <span>
                      CUIT {customer.cuit}
                    </span>
                  )}
                </div>
              </div>

              {/* CÓDIGO GRANDE */}

              <div className="shrink-0 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Código
                </p>

                <p className="mt-1 text-lg font-bold text-gray-900">
                  {formatCustomerCode(
                    customer.erp_id
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* DATOS */}

          <div className="grid gap-px bg-gray-100 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Condición fiscal
              </p>

              <p className="mt-2 break-words font-semibold text-gray-900">
                {customer.fiscal_condition ||
                  "-"}
              </p>
            </div>

            <div className="bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Localidad
              </p>

              <p className="mt-2 break-words font-semibold text-gray-900">
                {customer.locality_name ||
                  "-"}
              </p>
            </div>

            <div className="bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Código postal
              </p>

              <p className="mt-2 font-semibold text-gray-900">
                {customer.postal_code ||
                  "-"}
              </p>
            </div>

            <div className="bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Zona
              </p>

              <p className="mt-2 font-semibold text-gray-900">
                {customer.zone || "-"}
              </p>
            </div>

            <div className="bg-white p-5 sm:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Domicilio
              </p>

              <p className="mt-2 break-words font-semibold text-gray-900">
                {customer.address || "-"}
              </p>
            </div>

            <div className="bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Teléfono
              </p>

              <p className="mt-2 break-words font-semibold text-gray-900">
                {customer.phone || "-"}
              </p>
            </div>

            <div className="bg-white p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Email
              </p>

              {customer.email ? (
                <a
                  href={`mailto:${customer.email}`}
                  className="mt-2 block break-all font-semibold text-gray-900 transition hover:text-red-700"
                >
                  {customer.email}
                </a>
              ) : (
                <p className="mt-2 font-semibold text-gray-900">
                  -
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ===================================================
            SALDOS
        =================================================== */}

        <section className="mt-6">
          <div className="mb-3">
            <h2 className="text-lg font-bold text-gray-900">
              Resumen de cuenta
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Estado actual de las cuentas del cliente
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {/* CUENTA CORRIENTE */}

            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="h-1 bg-red-700" />

              <div className="p-5 sm:p-6">
                <p className="text-sm font-medium text-gray-500">
                  Saldo cuenta corriente
                </p>

                <p
                  className={`mt-2 break-words text-2xl font-bold sm:text-3xl ${getBalanceClass(
                    whiteBalance
                  )}`}
                >
                  {formatMoney(
                    Math.abs(
                      whiteBalance
                    )
                  )}
                </p>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      whiteBalance > 0
                        ? "bg-red-50 text-red-700"
                        : whiteBalance < 0
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {getBalanceText(
                      whiteBalance
                    )}
                  </span>

                  <span className="text-xs text-gray-400">
                    {whiteMovements.length} movimientos
                  </span>
                </div>
              </div>
            </div>

            {/* CUENTA 2 */}

            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="h-1 bg-gray-900" />

              <div className="p-5 sm:p-6">
                <p className="text-sm font-medium text-gray-500">
                  Saldo cuenta 2
                </p>

                <p
                  className={`mt-2 break-words text-2xl font-bold sm:text-3xl ${getBalanceClass(
                    blackBalance
                  )}`}
                >
                  {formatMoney(
                    Math.abs(
                      blackBalance
                    )
                  )}
                </p>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      blackBalance > 0
                        ? "bg-red-50 text-red-700"
                        : blackBalance < 0
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {getBalanceText(
                      blackBalance
                    )}
                  </span>

                  <span className="text-xs text-gray-400">
                    {blackMovements.length} movimientos
                  </span>
                </div>
              </div>
            </div>

            {/* MOVIMIENTOS */}

            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="h-1 bg-gray-400" />

              <div className="p-5 sm:p-6">
                <p className="text-sm font-medium text-gray-500">
                  Movimientos
                </p>

                <p className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
                  {safeMovements.length}
                </p>

                <div className="mt-3 space-y-1 text-xs text-gray-500">
                  <p>
                    {whiteMovements.length} en cuenta corriente
                  </p>

                  <p>
                    {blackMovements.length} en cuenta 2
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===================================================
            ERRORES
        =================================================== */}

        {movementsError && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 shadow-sm">
            <p className="font-semibold">
              Error al cargar movimientos
            </p>

            <p className="mt-1 text-sm">
              {movementsError.message}
            </p>
          </div>
        )}

        {invoicesErrorMessage && (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm">
            <p className="font-semibold">
              Error al cargar los números de comprobante
            </p>

            <p className="mt-1 text-sm">
              {invoicesErrorMessage}
            </p>
          </div>
        )}

        {/* ===================================================
            MOVIMIENTOS
        =================================================== */}

        {!movementsError && (
          <div className="mt-6">
            <div className="mb-3">
              <h2 className="text-lg font-bold text-gray-900">
                Movimientos
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Consultá la cuenta corriente o la cuenta 2 del cliente
              </p>
            </div>

            <MovementsTabs
              whiteMovements={
                whiteMovements
              }
              blackMovements={
                blackMovements
              }
              documentNumbers={
                documentNumbers
              }
            />
          </div>
        )}
      </div>
    </main>
  );
}