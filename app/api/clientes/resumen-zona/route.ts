import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccountType = "white" | "black";
type PeriodMode = "range" | "full";

type Customer = {
  erp_id: number;
  business_name: string | null;
  name: string | null;
  cuit: string | null;
  address: string | null;
  locality_name: string | null;
  zone: string | null;
  fiscal_condition: string | null;
};

type Movement = {
  erp_id: number;
  customer_id: number;
  registered_at: string | null;
  document_type: number | null;
  document_id: number | null;
  debit: number | string | null;
  credit: number | string | null;
};

type InvoiceRow = {
  erp_id: number;
  number: number | string | null;
};

type PdfRow = {
  date: string;
  document: string;
  observations: string;
  debit: number;
  credit: number;
  balance: number;
};

const WHITE_DOCUMENT_TYPES = [1, 2, 6, 20];
const BLACK_DOCUMENT_TYPES = [66, 67, 68, 69];

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 38;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 42;
const PAGE_SIZE = 1000;

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getDocumentPrefix(documentType: number | null | undefined) {
  switch (Number(documentType)) {
    case 1:
      return "FC";
    case 2:
      return "NC";
    case 6:
      return "ND";
    case 20:
      return "REC";
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

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function ascii(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "");
}

function sanitizeFileName(value: string) {
  return ascii(value)
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function isDateInside(value: string | null, from: string, to: string) {
  if (!value) return false;
  const date = value.slice(0, 10);
  return date >= from && date <= to;
}

function truncateText(
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number
) {
  const clean = ascii(value);

  if (font.widthOfTextAtSize(clean, size) <= maxWidth) {
    return clean;
  }

  let result = clean;
  while (
    result.length > 0 &&
    font.widthOfTextAtSize(`${result}...`, size) > maxWidth
  ) {
    result = result.slice(0, -1);
  }

  return `${result}...`;
}

function drawRightText(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number
) {
  const safeText = ascii(text);
  const width = font.widthOfTextAtSize(safeText, size);

  page.drawText(safeText, {
    x: rightX - width,
    y,
    font,
    size,
    color: rgb(0.08, 0.08, 0.08),
  });
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const zone = (request.nextUrl.searchParams.get("zone") ?? "").trim();
    const account: AccountType =
      request.nextUrl.searchParams.get("account") === "black"
        ? "black"
        : "white";
    const mode: PeriodMode =
      request.nextUrl.searchParams.get("mode") === "full"
        ? "full"
        : "range";
    const from = request.nextUrl.searchParams.get("from") ?? "";
    const to = request.nextUrl.searchParams.get("to") ?? "";
    const onlyWithMovements =
      request.nextUrl.searchParams.get("onlyWithMovements") !== "false";
    const onlyWithDebt =
      request.nextUrl.searchParams.get("onlyWithDebt") !== "false";

    if (!zone) {
      return NextResponse.json(
        { error: "Seleccioná una zona." },
        { status: 400 }
      );
    }

    if (
      mode === "range" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(to))
    ) {
      return NextResponse.json(
        { error: "El período seleccionado no es válido." },
        { status: 400 }
      );
    }

    if (mode === "range" && from > to) {
      return NextResponse.json(
        { error: "La fecha desde no puede ser posterior a la fecha hasta." },
        { status: 400 }
      );
    }

    // =========================================================
    // CLIENTES DE LA ZONA - PAGINADO
    // =========================================================
    const customers: Customer[] = [];
    let customerFrom = 0;

    while (true) {
      const { data, error } = await supabase
        .from("customers")
        .select(`
          erp_id,
          business_name,
          name,
          cuit,
          address,
          locality_name,
          zone,
          fiscal_condition
        `)
        .eq("zone", zone)
        .order("business_name", { ascending: true })
        .range(customerFrom, customerFrom + PAGE_SIZE - 1);

      if (error) {
        return NextResponse.json(
          { error: `No se pudieron cargar los clientes: ${error.message}` },
          { status: 500 }
        );
      }

      const rows = (data ?? []) as Customer[];
      customers.push(...rows);

      if (rows.length < PAGE_SIZE) break;
      customerFrom += PAGE_SIZE;
    }

    if (customers.length === 0) {
      return NextResponse.json(
        { error: `No hay clientes en la zona ${zone}.` },
        { status: 404 }
      );
    }

    const customerIds = customers.map((customer) => customer.erp_id);
    const documentTypes =
      account === "white" ? WHITE_DOCUMENT_TYPES : BLACK_DOCUMENT_TYPES;

    // =========================================================
    // MOVIMIENTOS - CHUNKS + PAGINADO
    // =========================================================
    const allMovements: Movement[] = [];

    for (const customerChunk of chunkArray(customerIds, 50)) {
      let movementFrom = 0;

      while (true) {
        const { data, error } = await supabase
          .from("account_movements")
          .select(`
            erp_id,
            customer_id,
            registered_at,
            document_type,
            document_id,
            debit,
            credit
          `)
          .in("customer_id", customerChunk)
          .eq("deleted", false)
          .in("document_type", documentTypes)
          .order("erp_id", { ascending: true })
          .range(movementFrom, movementFrom + PAGE_SIZE - 1);

        if (error) {
          return NextResponse.json(
            { error: `No se pudieron cargar los movimientos: ${error.message}` },
            { status: 500 }
          );
        }

        const rows = (data ?? []) as Movement[];
        allMovements.push(...rows);

        if (rows.length < PAGE_SIZE) break;
        movementFrom += PAGE_SIZE;
      }
    }

    const movementsByCustomer = new Map<number, Movement[]>();

    for (const movement of allMovements) {
      const current = movementsByCustomer.get(movement.customer_id) ?? [];
      current.push(movement);
      movementsByCustomer.set(movement.customer_id, current);
    }

    for (const movements of movementsByCustomer.values()) {
      movements.sort((a, b) => {
        const dateA = a.registered_at ?? "";
        const dateB = b.registered_at ?? "";
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return a.erp_id - b.erp_id;
      });
    }

    // =========================================================
    // NÚMEROS DE COMPROBANTES
    // =========================================================
    const documentIds = Array.from(
      new Set(
        allMovements
          .map((movement) => Number(movement.document_id))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    );

    const invoiceRows: InvoiceRow[] = [];

    for (const idChunk of chunkArray(documentIds, 500)) {
      const { data, error } = await supabase
        .from("invoices")
        .select("erp_id,number")
        .in("erp_id", idChunk);

      if (!error) {
        invoiceRows.push(...((data ?? []) as InvoiceRow[]));
      }
    }

    const invoiceMap = new Map<number, number | string | null>();
    for (const invoice of invoiceRows) {
      invoiceMap.set(Number(invoice.erp_id), invoice.number);
    }

    function getDocumentNumber(movement: Movement) {
      const prefix = getDocumentPrefix(movement.document_type);
      const number =
        movement.document_id !== null && movement.document_id !== undefined
          ? invoiceMap.get(Number(movement.document_id))
          : null;

      if (number !== null && number !== undefined) {
        return prefix ? `${prefix}-${number}` : String(number);
      }

      if (movement.document_id !== null && movement.document_id !== undefined) {
        return prefix
          ? `${prefix}-${movement.document_id}`
          : String(movement.document_id);
      }

      return prefix || "-";
    }

    const periodLabel =
      mode === "full"
        ? "Historial completo"
        : `${formatDate(`${from}T12:00:00`)} al ${formatDate(
            `${to}T12:00:00`
          )}`;

    const accountLabel =
      account === "white" ? "Cuenta corriente" : "Cuenta 2";

    // =========================================================
    // PREPARAR CLIENTES A INCLUIR
    // =========================================================
    const prepared = customers
      .map((customer) => {
        const movements = movementsByCustomer.get(customer.erp_id) ?? [];

        let openingBalance = 0;
        let selectedMovements = movements;

        if (mode === "range") {
          openingBalance = roundCurrency(
            movements
              .filter(
                (movement) =>
                  movement.registered_at &&
                  movement.registered_at.slice(0, 10) < from
              )
              .reduce(
                (total, movement) =>
                  total +
                  Number(movement.debit ?? 0) -
                  Number(movement.credit ?? 0),
                0
              )
          );

          selectedMovements = movements.filter((movement) =>
            isDateInside(movement.registered_at, from, to)
          );
        }

        if (onlyWithMovements && selectedMovements.length === 0) {
          return null;
        }

        let runningBalance = openingBalance;

        const rows: PdfRow[] = selectedMovements.map((movement) => {
          const debit = roundCurrency(Number(movement.debit ?? 0));
          const credit = roundCurrency(Number(movement.credit ?? 0));
          runningBalance = roundCurrency(runningBalance + debit - credit);

          return {
            date: formatDateTime(movement.registered_at),
            document: getDocumentNumber(movement),
            observations: "",
            debit,
            credit,
            balance: runningBalance,
          };
        });

        const finalBalance = roundCurrency(runningBalance);

        if (onlyWithDebt && finalBalance <= 0) {
          return null;
        }

        return {
          customer,
          openingBalance,
          finalBalance,
          rows,
        };
      })
      .filter(
        (
          value
        ): value is {
          customer: Customer;
          openingBalance: number;
          finalBalance: number;
          rows: PdfRow[];
        } => value !== null
      );

    if (prepared.length === 0) {
      return NextResponse.json(
        {
          error:
            onlyWithDebt
              ? "No hay clientes con deuda mayor a $ 0 para la cuenta y período seleccionados."
              : "No hay clientes con movimientos para la cuenta y período seleccionados.",
        },
        { status: 404 }
      );
    }

    // =========================================================
    // PDF CONSOLIDADO
    // =========================================================
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let logo:
      | Awaited<ReturnType<typeof pdfDoc.embedJpg>>
      | null = null;

    try {
      const logoPath = path.join(process.cwd(), "public", "logo.jpg");
      const logoBytes = await fs.readFile(logoPath);
      logo = await pdfDoc.embedJpg(logoBytes);
    } catch {
      logo = null;
    }

    function drawHeader(
      targetPage: PDFPage,
      customer: Customer,
      openingBalance: number
    ) {
      let headerY = PAGE_HEIGHT - MARGIN_TOP;
      const customerName =
        customer.business_name || customer.name || "Sin nombre";

      if (logo) {
        const logoScale = Math.min(150 / logo.width, 56 / logo.height);
        targetPage.drawImage(logo, {
          x: MARGIN_X,
          y: headerY - 48,
          width: logo.width * logoScale,
          height: logo.height * logoScale,
        });
      } else {
        targetPage.drawText("LA CASA DEL TREN DELANTERO", {
          x: MARGIN_X,
          y: headerY - 24,
          size: 14,
          font: bold,
        });
      }

      targetPage.drawText("Resumen de cuenta", {
        x: 285,
        y: headerY - 10,
        size: 15,
        font: bold,
      });

      targetPage.drawText(
        truncateText(
          `${String(customer.erp_id).padStart(5, "0")} - ${customerName}`,
          bold,
          11,
          270
        ),
        { x: 285, y: headerY - 30, size: 11, font: bold }
      );

      targetPage.drawText(
        truncateText(ascii(customer.address || "-"), font, 8.5, 270),
        { x: 285, y: headerY - 45, size: 8.5, font }
      );

      targetPage.drawText(
        truncateText(
          `${ascii(customer.locality_name || "-")}   Zona: ${ascii(
            customer.zone || "-"
          )}`,
          font,
          8.5,
          270
        ),
        { x: 285, y: headerY - 59, size: 8.5, font }
      );

      targetPage.drawText(
        truncateText(
          `CUIT: ${ascii(customer.cuit || "-")}   ${ascii(
            customer.fiscal_condition || ""
          )}`,
          font,
          8.5,
          270
        ),
        { x: 285, y: headerY - 73, size: 8.5, font }
      );

      targetPage.drawText(`${accountLabel} - ${periodLabel}`, {
        x: MARGIN_X,
        y: headerY - 100,
        size: 9.5,
        font: bold,
      });

      if (mode === "range") {
        targetPage.drawText(
          `Saldo anterior al periodo: ${ascii(formatMoney(openingBalance))}`,
          {
            x: MARGIN_X,
            y: headerY - 116,
            size: 8.5,
            font,
          }
        );
      }

      return headerY - 143;
    }

    function drawTableHeader(targetPage: PDFPage, tableY: number) {
      const xDate = MARGIN_X;
      const xDocument = 125;
      const xObservation = 215;
      const xDebitRight = 400;
      const xCreditRight = 480;
      const xBalanceRight = 557;

      targetPage.drawRectangle({
        x: MARGIN_X,
        y: tableY - 4,
        width: PAGE_WIDTH - MARGIN_X * 2,
        height: 20,
        color: rgb(0.95, 0.95, 0.95),
      });

      targetPage.drawText("FECHA", {
        x: xDate,
        y: tableY + 2,
        font: bold,
        size: 7.5,
      });
      targetPage.drawText("COMPROBANTE", {
        x: xDocument,
        y: tableY + 2,
        font: bold,
        size: 7.5,
      });
      targetPage.drawText("OBSERVACIONES", {
        x: xObservation,
        y: tableY + 2,
        font: bold,
        size: 7.5,
      });
      drawRightText(targetPage, "DEBE", xDebitRight, tableY + 2, bold, 7.5);
      drawRightText(targetPage, "HABER", xCreditRight, tableY + 2, bold, 7.5);
      drawRightText(targetPage, "SALDO", xBalanceRight, tableY + 2, bold, 7.5);

      return tableY - 17;
    }

    for (const entry of prepared) {
      let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      let y = drawHeader(page, entry.customer, entry.openingBalance);
      y = drawTableHeader(page, y);

      if (entry.rows.length === 0) {
        page.drawText("No hay movimientos en el periodo seleccionado.", {
          x: MARGIN_X,
          y,
          size: 10,
          font,
        });
        y -= 28;
      } else {
        for (const row of entry.rows) {
          if (y < MARGIN_BOTTOM + 22) {
            page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
            y = drawHeader(page, entry.customer, entry.openingBalance);
            y = drawTableHeader(page, y);
          }

          page.drawText(truncateText(row.date, font, 7.3, 80), {
            x: MARGIN_X,
            y,
            size: 7.3,
            font,
          });
          page.drawText(truncateText(row.document, font, 7.3, 82), {
            x: 125,
            y,
            size: 7.3,
            font,
          });
          page.drawText(
            truncateText(row.observations || "-", font, 7.3, 105),
            { x: 215, y, size: 7.3, font }
          );
          drawRightText(
            page,
            row.debit !== 0 ? formatMoney(row.debit) : "$ 0,00",
            400,
            y,
            font,
            7.1
          );
          drawRightText(
            page,
            row.credit !== 0 ? formatMoney(row.credit) : "$ 0,00",
            480,
            y,
            font,
            7.1
          );
          drawRightText(page, formatMoney(row.balance), 557, y, font, 7.1);
          y -= 15;
        }
      }

      if (y < MARGIN_BOTTOM + 45) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = drawHeader(page, entry.customer, entry.openingBalance);
      }

      page.drawLine({
        start: { x: 355, y: y - 2 },
        end: { x: 557, y: y - 2 },
        thickness: 0.8,
        color: rgb(0.7, 0.7, 0.7),
      });

      page.drawText("Saldo final:", {
        x: 390,
        y: y - 19,
        size: 9,
        font: bold,
      });
      drawRightText(
        page,
        formatMoney(entry.finalBalance),
        557,
        y - 19,
        bold,
        9.5
      );
    }

    const pageCount = pdfDoc.getPageCount();
    pdfDoc.getPages().forEach((pdfPage, index) => {
      pdfPage.drawText(`Pagina ${index + 1} de ${pageCount}`, {
        x: PAGE_WIDTH - 105,
        y: 20,
        size: 7,
        font,
        color: rgb(0.45, 0.45, 0.45),
      });
    });

    const pdfBytes = await pdfDoc.save();
    const safeZone = sanitizeFileName(zone) || "SinZona";
    const accountFile =
      account === "white" ? "CuentaCorriente" : "Cuenta2";
    const periodFile =
      mode === "full"
        ? "HistorialCompleto"
        : `${from.replaceAll("-", "")}_${to.replaceAll("-", "")}`;
    const fileName = `Resumenes_Zona_${safeZone}_${accountFile}_${periodFile}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Clientes-Incluidos": String(prepared.length),
      },
    });
  } catch (error) {
    console.error("Error generando resúmenes por zona:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo generar el resumen por zona.",
      },
      { status: 500 }
    );
  }
}
