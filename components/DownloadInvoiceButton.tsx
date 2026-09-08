"use client";

import { useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";

type DownloadInvoiceButtonProps = {
  invoiceId: number;
  fileName?: string;
};

function getDownloadName(
  contentDisposition: string | null,
  fallback: string
) {
  if (!contentDisposition) {
    return fallback;
  }

  const utf8Match =
    contentDisposition.match(
      /filename\*=UTF-8''([^;]+)/i
    );

  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(
        utf8Match[1].replace(/["']/g, "")
      );
    } catch {
      // Si falla, seguimos con filename normal.
    }
  }

  const normalMatch =
    contentDisposition.match(
      /filename="?([^";]+)"?/i
    );

  return normalMatch?.[1] || fallback;
}

export default function DownloadInvoiceButton({
  invoiceId,
  fileName,
}: DownloadInvoiceButtonProps) {
  const [downloading, setDownloading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  async function handleDownload() {
    if (downloading) return;

    setDownloading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/comprobantes/${invoiceId}/pdf`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      if (!response.ok) {
        let message =
          "No se pudo generar el comprobante.";

        try {
          const contentType =
            response.headers.get(
              "content-type"
            ) || "";

          if (
            contentType.includes(
              "application/json"
            )
          ) {
            const payload =
              await response.json();

            if (
              payload &&
              typeof payload.error ===
                "string"
            ) {
              message = payload.error;
            }
          } else {
            const body =
              await response.text();

            if (body.trim()) {
              message = body.trim();
            }
          }
        } catch {
          // Conservamos el mensaje por defecto.
        }

        throw new Error(message);
      }

      const blob = await response.blob();

      const fallbackName =
        fileName ||
        `Comprobante_${invoiceId}.pdf`;

      const finalFileName =
        getDownloadName(
          response.headers.get(
            "content-disposition"
          ),
          fallbackName
        );

      const objectUrl =
        window.URL.createObjectURL(blob);

      const link =
        document.createElement("a");

      link.href = objectUrl;
      link.download = finalFileName;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => {
        window.URL.revokeObjectURL(
          objectUrl
        );
      }, 1000);
    } catch (downloadError) {
      console.error(
        "Error descargando comprobante:",
        downloadError
      );

      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "No se pudo descargar el comprobante."
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        aria-busy={downloading}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
      >
        <span aria-hidden="true">
          📄
        </span>

        {downloading
          ? "GENERANDO..."
          : "DESCARGAR COMPROBANTE"}
      </button>

      <LoadingOverlay
        visible={downloading}
        text="Generando comprobante..."
      />

      {error && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-[10000] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 shadow-xl"
        >
          {error}
        </div>
      )}
    </>
  );
}
