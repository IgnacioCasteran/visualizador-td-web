import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type PageProps = {
  params: Promise<{
    erp_id: string;
    invoice_id: string;
  }>;
  searchParams: Promise<{
    from?: string | string[];
  }>;
};

type InvoiceItem = {
  erp_id: number;
  invoice_id: number;
  article_id: number | null;
  article_code: string | null;
  description: string | null;
  quantity: number | string | null;
  unit_price: number | string | null;
  discount_percentage: number | string | null;
  iva_percentage: number | string | null;
};

function formatMoney(
  value: number | string | null | undefined
) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(Number(value ?? 0));
}

function formatDate(
  value: string | null | undefined
) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
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

function formatQuantity(
  value: number | string | null | undefined
) {
  const numericValue = Number(value ?? 0);

  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(numericValue);
}

function formatPercentage(
  value: number | string | null | undefined
) {
  const numericValue = Number(value ?? 0);

  return `${new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numericValue)}%`;
}

function getDocumentInfo(
  documentType: number | null | undefined
) {
  switch (Number(documentType)) {
    case 1:
      return {
        title: "Factura",
        prefix: "FC",
        account: "Cuenta corriente",
      };

    case 2:
      return {
        title: "Nota de crédito",
        prefix: "NC",
        account: "Cuenta corriente",
      };

    case 6:
      return {
        title: "Nota de débito",
        prefix: "ND",
        account: "Cuenta corriente",
      };

    case 66:
      return {
        title: "Factura 2",
        prefix: "FCX",
        account: "Cuenta 2 / Pedidos",
      };

    case 68:
      return {
        title: "Nota de crédito 2",
        prefix: "NCX",
        account: "Cuenta 2 / Pedidos",
      };

    case 69:
      return {
        title: "Nota de débito 2",
        prefix: "NDX",
        account: "Cuenta 2 / Pedidos",
      };

    default:
      return {
        title: "Comprobante",
        prefix: "DOC",
        account: "Cuenta",
      };
  }
}

function calculateLineSubtotal(item: InvoiceItem) {
  const quantity = Number(item.quantity ?? 0);
  const unitPrice = Number(item.unit_price ?? 0);
  const discountPercentage = Number(
    item.discount_percentage ?? 0
  );

  const gross = quantity * unitPrice;

  const discount =
    gross * (discountPercentage / 100);

  return gross - discount;
}

function resolveReturnUrl(
  from: string | string[] | undefined,
  customerId: string
) {
  const rawFrom =
    Array.isArray(from)
      ? from[0]
      : from;

  if (
    rawFrom &&
    rawFrom.startsWith("/") &&
    !rawFrom.startsWith("//")
  ) {
    return rawFrom;
  }

  return `/clientes/${customerId}`;
}

function getReturnLabel(returnUrl: string) {
  if (
    returnUrl.startsWith(
      "/historico-articulos"
    )
  ) {
    return "← Volver al histórico";
  }

  return "← Volver al cliente";
}

export default async function InvoicePage({
  params,
  searchParams,
}: PageProps) {
  const { erp_id, invoice_id } = await params;

  const resolvedSearchParams =
    await searchParams;

  const returnUrl =
    resolveReturnUrl(
      resolvedSearchParams.from,
      erp_id
    );

  const returnLabel =
    getReturnLabel(returnUrl);

  const customerId = Number(erp_id);
  const invoiceId = Number(invoice_id);

  /*
   * =========================================================
   * CLIENTE
   * =========================================================
   */

  const { data: customer } = await supabase
    .from("customers")
    .select(`
      erp_id,
      business_name,
      name,
      cuit,
      locality_name,
      address
    `)
    .eq("erp_id", customerId)
    .maybeSingle();

  /*
   * =========================================================
   * COMPROBANTE
   * =========================================================
   */

  const {
    data: invoice,
    error: invoiceError,
  } = await supabase
    .from("invoices")
    .select(`
      erp_id,
      customer_id,
      document_type,
      form,
      number,
      issued_at,
      due_at,
      total,
      net_amount,
      exempt_amount,
      taxed_amount_21,
      discount,
      observations,
      cae,
      cancelled
    `)
    .eq("erp_id", invoiceId)
    .eq("customer_id", customerId)
    .maybeSingle();

  /*
   * =========================================================
   * ARTÍCULOS
   * =========================================================
   */

  const {
    data: items,
    error: itemsError,
  } = await supabase
    .from("invoice_items")
    .select(`
      erp_id,
      invoice_id,
      article_id,
      article_code,
      description,
      quantity,
      unit_price,
      discount_percentage,
      iva_percentage
    `)
    .eq("invoice_id", invoiceId)
    .order("erp_id", {
      ascending: true,
    });

  /*
   * =========================================================
   * USUARIO QUE CONFECCIONÓ EL COMPROBANTE
   * =========================================================
   *
   * article_history guarda el usuario proveniente de
   * Ventaspedidos.usuarioId / Usuarios.Nombre.
   * Todos los renglones de un mismo comprobante comparten
   * el mismo usuario, por eso alcanza con tomar uno.
   */

  const {
    data: invoiceUser,
    error: invoiceUserError,
  } = await supabase
    .from("article_history")
    .select(`
      user_id,
      user_name
    `)
    .eq("invoice_id", invoiceId)
    .eq("customer_id", customerId)
    .not("user_name", "is", null)
    .limit(1)
    .maybeSingle();

  if (invoiceUserError) {
    console.error(
      "Error obteniendo usuario del comprobante:",
      invoiceUserError
    );
  }

  const createdBy =
    invoiceUser?.user_name?.trim() || null;

  /*
   * =========================================================
   * ÚLTIMA SINCRONIZACIÓN
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
    syncStatus?.success === true
      ? syncStatus.last_completed_at
      : null;

  /*
   * =========================================================
   * ERROR
   * =========================================================
   */

  if (invoiceError || !invoice) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="h-1.5 bg-red-700" />

        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          <Link
            href={returnUrl}
            className="text-sm font-semibold text-gray-600 hover:text-red-700"
          >
            {returnLabel}
          </Link>

          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
            No se pudo encontrar el comprobante.
          </div>
        </div>
      </main>
    );
  }

  const safeItems =
    (items ?? []) as InvoiceItem[];

  const documentInfo =
    getDocumentInfo(
      invoice.document_type
    );

  const customerName =
    customer?.business_name ||
    customer?.name ||
    `Cliente ${customerId}`;

  const caeValue = String(invoice.cae ?? "").trim();
  const hasCae =
    caeValue !== "" &&
    caeValue !== "0";

  return (
    <main className="min-h-screen bg-slate-50">
      {/* BARRA ROJA */}

      <div className="h-1.5 w-full bg-red-700" />

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="border-b bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-40 shrink-0 items-center justify-center sm:h-20 sm:w-48">
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
              <h1 className="text-xl font-bold text-gray-900 lg:text-2xl">
                Detalle de comprobante
              </h1>

              <p className="mt-1 text-sm text-gray-500">
                Visualizador TD
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 md:flex">
            <span className="h-2.5 w-2.5 rounded-full bg-green-500" />

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

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* VOLVER */}

        <Link
          href={returnUrl}
          className="inline-flex items-center text-sm font-semibold text-gray-600 transition hover:text-red-700"
        >
          {returnLabel}
        </Link>

        {/* ===================================================
            CABECERA DEL COMPROBANTE
        =================================================== */}

        <section className="mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-5 sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
                    {documentInfo.title}
                  </span>

                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                    {documentInfo.account}
                  </span>

                  {invoice.cancelled && (
                    <span className="rounded-full bg-red-700 px-3 py-1 text-xs font-bold text-white">
                      ANULADO
                    </span>
                  )}
                </div>

                <h2 className="mt-4 text-2xl font-bold text-gray-900 sm:text-3xl">
                  {documentInfo.prefix}-
                  {invoice.number}
                </h2>

                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-500">
                  <span>
                    Formulario{" "}
                    <strong className="text-gray-700">
                      {invoice.form || "-"}
                    </strong>
                  </span>

                  <span>
                    Fecha{" "}
                    <strong className="text-gray-700">
                      {formatDate(
                        invoice.issued_at
                      )}
                    </strong>
                  </span>

                  {invoice.due_at && (
                    <span>
                      Vencimiento{" "}
                      <strong className="text-gray-700">
                        {formatDate(
                          invoice.due_at
                        )}
                      </strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 sm:text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Total
                </p>

                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {formatMoney(
                    invoice.total
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* CLIENTE */}

          <div className="grid border-b border-gray-100 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border-b border-gray-100 p-5 sm:border-r lg:border-b-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Cliente
              </p>

              <p className="mt-2 font-bold text-gray-900">
                {customerName}
              </p>
            </div>

            <div className="border-b border-gray-100 p-5 lg:border-b-0 lg:border-r">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                CUIT
              </p>

              <p className="mt-2 font-semibold text-gray-900">
                {customer?.cuit || "-"}
              </p>
            </div>

            <div className="border-b border-gray-100 p-5 sm:border-r lg:border-b-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Localidad
              </p>

              <p className="mt-2 font-semibold text-gray-900">
                {customer?.locality_name ||
                  "-"}
              </p>
            </div>

            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Confeccionado por
              </p>

              <p className="mt-2 font-bold text-gray-900">
                {createdBy || "-"}
              </p>
            </div>
          </div>

          {/* OBSERVACIONES */}

          {invoice.observations && (
            <div className="border-b border-gray-100 p-5 sm:p-6">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
                  Observaciones
                </p>

                <p className="mt-2 whitespace-pre-wrap font-semibold text-gray-900">
                  {invoice.observations}
                </p>
              </div>
            </div>
          )}

          {/* DATOS FISCALES */}

          <div className="grid sm:grid-cols-2 lg:grid-cols-4">
            <div className="border-b border-gray-100 p-5 sm:border-r lg:border-b-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Neto
              </p>

              <p className="mt-2 font-bold text-gray-900">
                {formatMoney(
                  invoice.net_amount
                )}
              </p>
            </div>

            <div className="border-b border-gray-100 p-5 lg:border-b-0 lg:border-r">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                IVA 21%
              </p>

              <p className="mt-2 font-bold text-gray-900">
                {formatMoney(
                  invoice.taxed_amount_21
                )}
              </p>
            </div>

            <div className="border-b border-gray-100 p-5 sm:border-r lg:border-b-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Exento
              </p>

              <p className="mt-2 font-bold text-gray-900">
                {formatMoney(
                  invoice.exempt_amount
                )}
              </p>
            </div>

            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Descuento
              </p>

              <p className="mt-2 font-bold text-gray-900">
                {formatPercentage(
                  invoice.discount
                )}
              </p>
            </div>
          </div>
        </section>

        {/* ===================================================
            ARTÍCULOS
        =================================================== */}

        <section className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-5 sm:px-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                Artículos
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Detalle de renglones del comprobante
              </p>
            </div>

            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
              {safeItems.length}{" "}
              {safeItems.length === 1
                ? "artículo"
                : "artículos"}
            </span>
          </div>

          {itemsError ? (
            <div className="p-6 text-red-700">
              Error al cargar artículos:{" "}
              {itemsError.message}
            </div>
          ) : safeItems.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              Este comprobante no tiene artículos sincronizados.
            </div>
          ) : (
            <>
              {/* DESKTOP */}

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Código
                      </th>

                      <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Descripción
                      </th>

                      <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Cantidad
                      </th>

                      <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Precio unitario
                      </th>

                      <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Desc.
                      </th>

                      <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                        IVA
                      </th>

                      <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Subtotal
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {safeItems.map(
                      (item) => (
                        <tr
                          key={item.erp_id}
                          className="border-t border-gray-100"
                        >
                          <td className="whitespace-nowrap px-5 py-4 font-bold text-gray-900">
                            {item.article_code ||
                              "-"}
                          </td>

                          <td className="min-w-[320px] px-5 py-4 text-sm text-gray-700">
                            {item.description ||
                              "-"}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 text-right font-medium">
                            {formatQuantity(
                              item.quantity
                            )}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 text-right">
                            {formatMoney(
                              item.unit_price
                            )}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 text-right">
                            {formatPercentage(
                              item.discount_percentage
                            )}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 text-right">
                            {formatPercentage(
                              item.iva_percentage
                            )}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 text-right font-bold text-gray-900">
                            {formatMoney(
                              calculateLineSubtotal(
                                item
                              )
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>

              {/* MOBILE */}

              <div className="divide-y divide-gray-100 md:hidden">
                {safeItems.map(
                  (item) => (
                    <article
                      key={item.erp_id}
                      className="p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                            Código
                          </p>

                          <p className="mt-1 font-bold text-gray-900">
                            {item.article_code ||
                              "-"}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-xs text-gray-400">
                            Cantidad
                          </p>

                          <p className="mt-1 font-bold">
                            {formatQuantity(
                              item.quantity
                            )}
                          </p>
                        </div>
                      </div>

                      <p className="mt-4 text-sm leading-6 text-gray-700">
                        {item.description ||
                          "-"}
                      </p>

                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-gray-50 p-3">
                          <p className="text-xs text-gray-500">
                            Precio unitario
                          </p>

                          <p className="mt-1 text-sm font-bold">
                            {formatMoney(
                              item.unit_price
                            )}
                          </p>
                        </div>

                        <div className="rounded-xl bg-gray-50 p-3">
                          <p className="text-xs text-gray-500">
                            Descuento
                          </p>

                          <p className="mt-1 text-sm font-bold">
                            {formatPercentage(
                              item.discount_percentage
                            )}
                          </p>
                        </div>

                        <div className="rounded-xl bg-gray-50 p-3">
                          <p className="text-xs text-gray-500">
                            IVA
                          </p>

                          <p className="mt-1 text-sm font-bold">
                            {formatPercentage(
                              item.iva_percentage
                            )}
                          </p>
                        </div>

                        <div className="rounded-xl bg-gray-50 p-3">
                          <p className="text-xs text-gray-500">
                            Subtotal
                          </p>

                          <p className="mt-1 text-sm font-bold">
                            {formatMoney(
                              calculateLineSubtotal(
                                item
                              )
                            )}
                          </p>
                        </div>
                      </div>
                    </article>
                  )
                )}
              </div>
            </>
          )}
        </section>

        {/* ===================================================
            TOTALES / CAE
        =================================================== */}

        <div
          className={`mt-6 grid gap-5 ${
            hasCae
              ? "lg:grid-cols-[1fr_380px]"
              : "lg:grid-cols-[380px] lg:justify-end"
          }`}
        >
          {hasCae && (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="font-bold text-gray-900">
                Datos fiscales
              </h3>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  CAE
                </p>

                <p className="mt-1 break-all font-semibold text-gray-900">
                  {caeValue}
                </p>
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="font-bold text-gray-900">
                Totales
              </h3>
            </div>

            <div className="space-y-3 p-5">
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-gray-500">
                  Neto
                </span>

                <span className="font-semibold">
                  {formatMoney(
                    invoice.net_amount
                  )}
                </span>
              </div>

              <div className="flex justify-between gap-4 text-sm">
                <span className="text-gray-500">
                  IVA 21%
                </span>

                <span className="font-semibold">
                  {formatMoney(
                    invoice.taxed_amount_21
                  )}
                </span>
              </div>

              {Number(
                invoice.exempt_amount ?? 0
              ) !== 0 && (
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-gray-500">
                    Exento
                  </span>

                  <span className="font-semibold">
                    {formatMoney(
                      invoice.exempt_amount
                    )}
                  </span>
                </div>
              )}

              {Number(
                invoice.discount ?? 0
              ) !== 0 && (
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-gray-500">
                    Descuento
                  </span>

                  <span className="font-semibold text-red-700">
                    {formatPercentage(
                      invoice.discount
                    )}
                  </span>
                </div>
              )}

              <div className="border-t border-gray-200 pt-3">
                <div className="flex items-end justify-between gap-4">
                  <span className="font-bold text-gray-900">
                    Total
                  </span>

                  <span className="text-2xl font-bold text-red-700">
                    {formatMoney(
                      invoice.total
                    )}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}