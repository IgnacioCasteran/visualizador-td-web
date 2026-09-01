"use client";

import { useMemo, useState } from "react";
import { CalendarDays, FileDown, Loader2, X } from "lucide-react";

type Props = {
  customerId: number;
  customerName: string;
};

type AccountType = "white" | "black";
type PeriodMode = "range" | "full";

function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function buildDefaultDates() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);

  return {
    from: toInputDate(from),
    to: toInputDate(today),
  };
}

export default function AccountSummaryButton({
  customerId,
  customerName,
}: Props) {
  const defaults = useMemo(() => buildDefaultDates(), []);

  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<AccountType>("white");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("range");
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeModal() {
    if (downloading) return;

    setOpen(false);
    setError(null);
  }

  async function downloadSummary() {
    setError(null);

    if (periodMode === "range") {
      if (!dateFrom || !dateTo) {
        setError("Elegí la fecha desde y hasta.");
        return;
      }

      if (dateFrom > dateTo) {
        setError("La fecha desde no puede ser posterior a la fecha hasta.");
        return;
      }
    }

    setDownloading(true);

    try {
      const params = new URLSearchParams({
        account,
        mode: periodMode,
      });

      if (periodMode === "range") {
        params.set("from", dateFrom);
        params.set("to", dateTo);
      }

      const response = await fetch(
        `/api/clientes/${customerId}/resumen-cuenta?${params.toString()}`
      );

      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          const payload = await response.json();

          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : "No se pudo generar el resumen."
          );
        }

        throw new Error("No se pudo generar el resumen.");
      }

      const blob = await response.blob();
      const contentDisposition =
        response.headers.get("content-disposition") ?? "";

      const fileNameMatch = contentDisposition.match(
        /filename="?([^"]+)"?/i
      );

      const safeCustomerName = customerName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

      const fallbackName =
        account === "white"
          ? `Resumen_${customerId}_${safeCustomerName}_CuentaCorriente.pdf`
          : `Resumen_${customerId}_${safeCustomerName}_Cuenta2.pdf`;

      const fileName = fileNameMatch?.[1] || fallbackName;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = fileName;

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      URL.revokeObjectURL(url);

      setOpen(false);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "No se pudo generar el resumen."
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
      >
        <FileDown className="h-4 w-4" />
        Descargar resumen
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 sm:px-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  Descargar resumen de cuenta
                </h3>

                <p className="mt-1 text-sm text-gray-500">
                  {customerName}
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={downloading}
                className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 p-5 sm:p-6">
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-800">
                  Cuenta
                </label>

                <select
                  value={account}
                  onChange={(event) =>
                    setAccount(event.target.value as AccountType)
                  }
                  disabled={downloading}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
                >
                  <option value="white">
                    Cuenta corriente
                  </option>

                  <option value="black">
                    Cuenta 2
                  </option>
                </select>
              </div>

              <div>
                <label className="mb-3 block text-sm font-bold text-gray-800">
                  Período
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label
                    className={`cursor-pointer rounded-xl border p-4 transition ${
                      periodMode === "range"
                        ? "border-red-300 bg-red-50"
                        : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="periodMode"
                        value="range"
                        checked={periodMode === "range"}
                        onChange={() => setPeriodMode("range")}
                        disabled={downloading}
                        className="h-4 w-4 accent-red-700"
                      />

                      <span className="text-sm font-bold text-gray-900">
                        Elegir período
                      </span>
                    </div>

                    <p className="mt-1 pl-6 text-xs text-gray-500">
                      Seleccioná fecha desde y hasta
                    </p>
                  </label>

                  <label
                    className={`cursor-pointer rounded-xl border p-4 transition ${
                      periodMode === "full"
                        ? "border-red-300 bg-red-50"
                        : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="periodMode"
                        value="full"
                        checked={periodMode === "full"}
                        onChange={() => setPeriodMode("full")}
                        disabled={downloading}
                        className="h-4 w-4 accent-red-700"
                      />

                      <span className="text-sm font-bold text-gray-900">
                        Historial completo
                      </span>
                    </div>

                    <p className="mt-1 pl-6 text-xs text-gray-500">
                      Incluye todos los movimientos disponibles
                    </p>
                  </label>
                </div>
              </div>

              {periodMode === "range" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      Desde
                    </label>

                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />

                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(event) => setDateFrom(event.target.value)}
                        disabled={downloading}
                        className="w-full rounded-xl border border-gray-300 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      Hasta
                    </label>

                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />

                      <input
                        type="date"
                        value={dateTo}
                        onChange={(event) => setDateTo(event.target.value)}
                        disabled={downloading}
                        className="w-full rounded-xl border border-gray-300 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
                      />
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                  {error}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button
                type="button"
                onClick={closeModal}
                disabled={downloading}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={downloadSummary}
                disabled={downloading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4" />
                )}

                {downloading
                  ? "Generando..."
                  : "Descargar PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
