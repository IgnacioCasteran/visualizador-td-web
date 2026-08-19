import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type PageProps = {
  params: Promise<{
    erp_id: string;
    receipt_id: string;
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

export default async function ReceiptPage({
  params,
}: PageProps) {
  const { erp_id, receipt_id } = await params;

  const customerId = Number(erp_id);
  const receiptId = Number(receipt_id);

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
      observations
    `)
    .eq("erp_id", receiptId)
    .eq("customer_id", customerId)
    .maybeSingle();

  const { data: customer } = await supabase
    .from("customers")
    .select(`
      business_name,
      name
    `)
    .eq("erp_id", customerId)
    .maybeSingle();

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

  if (receiptError || !receipt) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="h-1.5 w-full bg-red-700" />

        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <Link
            href={`/clientes/${erp_id}`}
            className="text-sm font-semibold text-gray-600 transition hover:text-red-700"
          >
            ← Volver al cliente
          </Link>

          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-sm">
            No se pudo encontrar el recibo.
          </div>
        </div>
      </main>
    );
  }

  const customerName =
    customer?.business_name ||
    customer?.name ||
    `Cliente ${customerId}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="h-1.5 w-full bg-red-700" />

      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href="/"
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

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Link
          href={`/clientes/${erp_id}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 transition hover:text-red-700"
        >
          ← Volver al cliente
        </Link>

        <section className="mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-5 sm:p-7">
            <span className="inline-flex rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
              Recibo
            </span>

            <h2 className="mt-3 text-2xl font-bold text-gray-900 sm:text-3xl">
              REC-{receipt.number}
            </h2>

            <p className="mt-2 text-sm text-gray-500">
              {customerName}
            </p>
          </div>

          <div className="grid gap-px bg-gray-100 sm:grid-cols-2">
            <div className="bg-white p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Fecha y hora
              </p>

              <p className="mt-2 text-base font-bold text-gray-900">
                {formatDateTime(receipt.issued_at)}
              </p>
            </div>

            <div className="bg-white p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Observación
              </p>

              <p className="mt-2 whitespace-pre-wrap break-words text-base font-bold text-gray-900">
                {receipt.observations || "Sin observaciones"}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
