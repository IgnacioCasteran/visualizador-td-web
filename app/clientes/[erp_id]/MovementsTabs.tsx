"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

type Movement = {
  erp_id: number;
  registered_at: string | null;
  document_type: number | null;
  document_id: number | null;
  debit: number | string | null;
  credit: number | string | null;
  balance: number | string | null;
};

type Props = {
  whiteMovements: Movement[];
  blackMovements: Movement[];
  documentNumbers: Record<string, string>;
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

function isInvoiceDocument(
  documentType: number | null | undefined,
  documentId: number | null | undefined
) {
  if (!documentId) return false;

  const invoiceDocumentTypes = [1, 2, 6, 66, 68, 69];

  return invoiceDocumentTypes.includes(Number(documentType));
}

function isReceiptDocument(
  documentType: number | null | undefined,
  documentId: number | null | undefined
) {
  if (!documentId) return false;

  return [20, 67].includes(Number(documentType));
}

function getDocumentHref(
  customerId: string,
  documentType: number | null | undefined,
  documentId: number | null | undefined
) {
  if (!customerId || !documentId) return null;

  if (isReceiptDocument(documentType, documentId)) {
    return `/clientes/${customerId}/recibos/${documentId}`;
  }

  if (isInvoiceDocument(documentType, documentId)) {
    return `/clientes/${customerId}/comprobantes/${documentId}`;
  }

  return null;
}

export default function MovementsTabs({
  whiteMovements,
  blackMovements,
  documentNumbers,
}: Props) {
  const params = useParams<{ erp_id: string }>();
  const customerId = params?.erp_id ?? "";

  const [activeTab, setActiveTab] = useState<
    "white" | "black"
  >("white");

  const movements =
    activeTab === "white"
      ? whiteMovements
      : blackMovements;

  const activeTitle =
    activeTab === "white"
      ? "Cuenta corriente"
      : "Cuenta 2 / Pedidos";

  const emptyMessage =
    activeTab === "white"
      ? "Este cliente no tiene movimientos de cuenta corriente."
      : "Este cliente no tiene movimientos de cuenta 2.";

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* =====================================================
          SELECTOR
      ===================================================== */}

      <div className="border-b border-gray-100 bg-white p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2">
          {/* CUENTA CORRIENTE */}

          <button
            type="button"
            onClick={() => setActiveTab("white")}
            className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition sm:px-5 ${
              activeTab === "white"
                ? "bg-red-700 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
            }`}
          >
            <span className="truncate">
              Cuenta corriente
            </span>

            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                activeTab === "white"
                  ? "bg-white/20 text-white"
                  : "bg-white text-gray-600"
              }`}
            >
              {whiteMovements.length}
            </span>
          </button>

          {/* CUENTA 2 */}

          <button
            type="button"
            onClick={() => setActiveTab("black")}
            className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition sm:px-5 ${
              activeTab === "black"
                ? "bg-gray-900 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
            }`}
          >
            <span className="truncate">
              Cuenta 2 / Pedidos
            </span>

            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                activeTab === "black"
                  ? "bg-white/20 text-white"
                  : "bg-white text-gray-600"
              }`}
            >
              {blackMovements.length}
            </span>
          </button>
        </div>
      </div>

      {/* =====================================================
          CABECERA
      ===================================================== */}

      <div className="border-b border-gray-100 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 sm:text-xl">
              {activeTitle}
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Detalle de movimientos registrados
            </p>
          </div>

          <span className="mt-2 inline-flex w-fit rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 sm:mt-0">
            {movements.length} movimientos
          </span>
        </div>
      </div>

      {/* =====================================================
          SIN MOVIMIENTOS
      ===================================================== */}

      {movements.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="font-medium text-gray-700">
            Sin movimientos
          </p>

          <p className="mt-1 text-sm text-gray-500">
            {emptyMessage}
          </p>
        </div>
      ) : (
        <>
          {/* =================================================
              DESKTOP / TABLET
          ================================================= */}

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Fecha
                  </th>

                  <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Número
                  </th>

                  <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Debe
                  </th>

                  <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Haber
                  </th>

                  <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Saldo
                  </th>
                </tr>
              </thead>

              <tbody>
                {movements.map((movement) => {
                  const debit = Number(
                    movement.debit ?? 0
                  );

                  const credit = Number(
                    movement.credit ?? 0
                  );

                  const balance = Number(
                    movement.balance ?? 0
                  );

                  const documentNumber =
                    documentNumbers[
                      String(movement.erp_id)
                    ] ?? "-";

                  const documentHref =
                    getDocumentHref(
                      customerId,
                      movement.document_type,
                      movement.document_id
                    );

                  const isReceipt =
                    isReceiptDocument(
                      movement.document_type,
                      movement.document_id
                    );

                  return (
                    <tr
                      key={movement.erp_id}
                      className="border-t border-gray-100 transition hover:bg-red-50/30"
                    >
                      {/* FECHA */}

                      <td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">
                        {formatDate(
                          movement.registered_at
                        )}
                      </td>

                      {/* NÚMERO */}

                      <td className="whitespace-nowrap px-5 py-4">
                        {documentHref ? (
                          <Link
                            href={documentHref}
                            className="group inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 shadow-sm transition hover:border-red-700 hover:bg-red-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-200"
                            title={
                              isReceipt
                                ? "Ver detalle del recibo"
                                : "Ver detalle del comprobante"
                            }
                          >
                            <span>{documentNumber}</span>

                            <span
                              aria-hidden="true"
                              className="text-base leading-none transition-transform group-hover:translate-x-0.5"
                            >
                              →
                            </span>
                          </Link>
                        ) : (
                          <span className="font-semibold text-gray-900">
                            {documentNumber}
                          </span>
                        )}
                      </td>

                      {/* DEBE */}

                      <td
                        className={`whitespace-nowrap px-5 py-4 text-right text-sm ${
                          debit < 0
                            ? "font-semibold text-red-700"
                            : "text-gray-700"
                        }`}
                      >
                        {formatMoney(debit)}
                      </td>

                      {/* HABER */}

                      <td
                        className={`whitespace-nowrap px-5 py-4 text-right text-sm ${
                          credit > 0
                            ? "font-semibold text-green-700"
                            : "text-gray-700"
                        }`}
                      >
                        {formatMoney(credit)}
                      </td>

                      {/* SALDO */}

                      <td
                        className={`whitespace-nowrap px-5 py-4 text-right text-sm font-semibold ${
                          balance < 0
                            ? "text-green-700"
                            : balance > 0
                              ? "text-red-700"
                              : "text-gray-900"
                        }`}
                      >
                        {formatMoney(balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* =================================================
              CELULAR
          ================================================= */}

          <div className="divide-y divide-gray-100 md:hidden">
            {movements.map((movement) => {
              const debit = Number(
                movement.debit ?? 0
              );

              const credit = Number(
                movement.credit ?? 0
              );

              const balance = Number(
                movement.balance ?? 0
              );

              const documentNumber =
                documentNumbers[
                  String(movement.erp_id)
                ] ?? "-";

              const documentHref =
                getDocumentHref(
                  customerId,
                  movement.document_type,
                  movement.document_id
                );

              const isReceipt =
                isReceiptDocument(
                  movement.document_type,
                  movement.document_id
                );

              return (
                <article
                  key={movement.erp_id}
                  className={`p-4 ${
                    documentHref
                      ? "bg-red-50/30"
                      : ""
                  }`}
                >
                  {/* CABECERA CARD */}

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                        Comprobante
                      </p>

                      {documentHref ? (
                        <div className="mt-2">
                          <p className="break-all text-base font-bold text-gray-900">
                            {documentNumber}
                          </p>

                          <Link
                            href={documentHref}
                            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-200"
                          >
                            {isReceipt
                              ? "Ver recibo"
                              : "Ver comprobante"}
                            <span
                              aria-hidden="true"
                              className="text-base leading-none"
                            >
                              →
                            </span>
                          </Link>
                        </div>
                      ) : (
                        <p className="mt-1 break-all font-bold text-gray-900">
                          {documentNumber}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-xs text-gray-400">
                        Fecha
                      </p>

                      <p className="mt-1 text-sm font-medium text-gray-700">
                        {formatDate(
                          movement.registered_at
                        )}
                      </p>
                    </div>
                  </div>

                  {/* IMPORTES */}

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {/* DEBE */}

                    <div className="rounded-xl bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500">
                        Debe
                      </p>

                      <p
                        className={`mt-1 break-words text-sm font-bold ${
                          debit < 0
                            ? "text-red-700"
                            : "text-gray-900"
                        }`}
                      >
                        {formatMoney(debit)}
                      </p>
                    </div>

                    {/* HABER */}

                    <div className="rounded-xl bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500">
                        Haber
                      </p>

                      <p
                        className={`mt-1 break-words text-sm font-bold ${
                          credit > 0
                            ? "text-green-700"
                            : "text-gray-900"
                        }`}
                      >
                        {formatMoney(credit)}
                      </p>
                    </div>
                  </div>

                  {/* SALDO */}

                  <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-3">
                    <div>
                      <p className="text-xs font-medium text-gray-500">
                        Saldo
                      </p>

                      <p
                        className={`mt-1 break-words text-base font-bold ${
                          balance < 0
                            ? "text-green-700"
                            : balance > 0
                              ? "text-red-700"
                              : "text-gray-900"
                        }`}
                      >
                        {formatMoney(balance)}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                        balance < 0
                          ? "bg-green-50 text-green-700"
                          : balance > 0
                            ? "bg-red-50 text-red-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {balance < 0
                        ? "A favor"
                        : balance > 0
                          ? "Debe"
                          : "Sin saldo"}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}