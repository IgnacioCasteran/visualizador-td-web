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

type RouteContext = {
  params: Promise<{
    erp_id: string;
  }>;
};

type AccountType = "white" | "black";

type Movement = {
  erp_id: number;
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

const WHITE_DOCUMENT_TYPES = [1, 2, 6, 20];
const BLACK_DOCUMENT_TYPES = [66, 67, 68, 69];

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 38;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 42;

function getDocumentPrefix(
  documentType: number | null | undefined
) {
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

function isDateInside(
  value: string | null,
  from: string,
  to: string
) {
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

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const supabase = await createClient();
    const { erp_id } = await params;

    const customerId = Number(erp_id);

    if (!Number.isFinite(customerId) || customerId <= 0) {
      return NextResponse.json(
        { error: "Cliente inválido." },
        { status: 400 }
      );
    }

    const account =
      request.nextUrl.searchParams.get("account") === "black"
        ? "black"
        : "white";

    const mode =
      request.nextUrl.searchParams.get("mode") === "full"
        ? "full"
        : "range";

    const from =
      request.nextUrl.searchParams.get("from") ?? "";

    const to =
      request.nextUrl.searchParams.get("to") ?? "";

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
        {
          error:
            "La fecha desde no puede ser posterior a la fecha hasta.",
        },
        { status: 400 }
      );
    }

    const {
      data: customer,
      error: customerError,
    } = await supabase
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
      .eq("erp_id", customerId)
      .single();

    if (customerError || !customer) {
      return NextResponse.json(
        { error: "No se pudo encontrar el cliente." },
        { status: 404 }
      );
    }

    // A partir de acá TypeScript sabe que el cliente existe.
    const safeCustomer = customer;

    const documentTypes =
      account === "white"
        ? WHITE_DOCUMENT_TYPES
        : BLACK_DOCUMENT_TYPES;

    const {
      data: movementData,
      error: movementsError,
    } = await supabase
      .from("account_movements")
      .select(`
        erp_id,
        registered_at,
        document_type,
        document_id,
        debit,
        credit
      `)
      .eq("customer_id", customerId)
      .eq("deleted", false)
      .in("document_type", documentTypes)
      .order("registered_at", {
        ascending: true,
      });

    if (movementsError) {
      return NextResponse.json(
        {
          error:
            `No se pudieron cargar los movimientos: ${movementsError.message}`,
        },
        { status: 500 }
      );
    }

    const allMovements = (movementData ?? []) as Movement[];

    let openingBalance = 0;
    let selectedMovements = allMovements;

    if (mode === "range") {
      openingBalance = allMovements
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
        );

      selectedMovements = allMovements.filter((movement) =>
        isDateInside(
          movement.registered_at,
          from,
          to
        )
      );
    }

    const documentIds = Array.from(
      new Set(
        selectedMovements
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

    let invoiceRows: InvoiceRow[] = [];

    if (documentIds.length > 0) {
      const {
        data: invoiceData,
        error: invoiceError,
      } = await supabase
        .from("invoices")
        .select(`
          erp_id,
          number
        `)
        .in("erp_id", documentIds);

      if (!invoiceError) {
        invoiceRows =
          (invoiceData ?? []) as InvoiceRow[];
      }
    }

    const invoiceMap = new Map<
      number,
      number | string | null
    >();

    for (const invoice of invoiceRows) {
      invoiceMap.set(
        Number(invoice.erp_id),
        invoice.number
      );
    }

    function getDocumentNumber(
      movement: Movement
    ) {
      const prefix = getDocumentPrefix(
        movement.document_type
      );

      const number =
        movement.document_id !== null &&
        movement.document_id !== undefined
          ? invoiceMap.get(
              Number(movement.document_id)
            )
          : null;

      if (
        number !== null &&
        number !== undefined
      ) {
        return prefix
          ? `${prefix}-${number}`
          : String(number);
      }

      if (
        movement.document_id !== null &&
        movement.document_id !== undefined
      ) {
        return prefix
          ? `${prefix}-${movement.document_id}`
          : String(movement.document_id);
      }

      return prefix || "-";
    }

    let runningBalance = openingBalance;

    const rows = selectedMovements.map(
      (movement) => {
        const debit = Number(
          movement.debit ?? 0
        );

        const credit = Number(
          movement.credit ?? 0
        );

        runningBalance += debit - credit;

        return {
          date: formatDateTime(
            movement.registered_at
          ),
          document:
            getDocumentNumber(movement),
          observations: "",
          debit,
          credit,
          balance: runningBalance,
        };
      }
    );

    const finalBalance = runningBalance;

    const customerName =
      safeCustomer.business_name ||
      safeCustomer.name ||
      "Sin nombre";

    const accountLabel =
      account === "white"
        ? "Cuenta corriente"
        : "Cuenta 2";

    const periodLabel =
      mode === "full"
        ? "Historial completo"
        : `${formatDate(`${from}T12:00:00`)} al ${formatDate(
            `${to}T12:00:00`
          )}`;

    const pdfDoc =
      await PDFDocument.create();

    const font =
      await pdfDoc.embedFont(
        StandardFonts.Helvetica
      );

    const bold =
      await pdfDoc.embedFont(
        StandardFonts.HelveticaBold
      );

    let logo:
      | Awaited<
          ReturnType<
            typeof pdfDoc.embedJpg
          >
        >
      | null = null;

    try {
      const logoPath = path.join(
        process.cwd(),
        "public",
        "logo.jpg"
      );

      const logoBytes =
        await fs.readFile(logoPath);

      logo =
        await pdfDoc.embedJpg(
          logoBytes
        );
    } catch {
      logo = null;
    }

    let page = pdfDoc.addPage([
      PAGE_WIDTH,
      PAGE_HEIGHT,
    ]);

    let y = PAGE_HEIGHT - MARGIN_TOP;

    function drawHeader(
      targetPage: PDFPage,
      continuation = false
    ) {
      let headerY =
        PAGE_HEIGHT - MARGIN_TOP;

      if (logo) {
        const logoScale =
          Math.min(
            150 / logo.width,
            56 / logo.height
          );

        targetPage.drawImage(logo, {
          x: MARGIN_X,
          y: headerY - 48,
          width:
            logo.width * logoScale,
          height:
            logo.height * logoScale,
        });
      } else {
        targetPage.drawText(
          "LA CASA DEL TREN DELANTERO",
          {
            x: MARGIN_X,
            y: headerY - 24,
            size: 14,
            font: bold,
          }
        );
      }

      targetPage.drawText(
        continuation
          ? "Resumen de cuenta - continuacion"
          : "Resumen de cuenta",
        {
          x: 285,
          y: headerY - 10,
          size: continuation ? 11 : 15,
          font: bold,
        }
      );

      if (!continuation) {
        targetPage.drawText(
          truncateText(
            `${String(safeCustomer.erp_id).padStart(5, "0")} - ${customerName}`,
            bold,
            11,
            270
          ),
          {
            x: 285,
            y: headerY - 30,
            size: 11,
            font: bold,
          }
        );

        targetPage.drawText(
          truncateText(
            ascii(safeCustomer.address || "-"),
            font,
            8.5,
            270
          ),
          {
            x: 285,
            y: headerY - 45,
            size: 8.5,
            font,
          }
        );

        targetPage.drawText(
          truncateText(
            `${ascii(
              safeCustomer.locality_name || "-"
            )}   Zona: ${ascii(
              safeCustomer.zone || "-"
            )}`,
            font,
            8.5,
            270
          ),
          {
            x: 285,
            y: headerY - 59,
            size: 8.5,
            font,
          }
        );

        targetPage.drawText(
          truncateText(
            `CUIT: ${ascii(
              safeCustomer.cuit || "-"
            )}   ${ascii(
              safeCustomer.fiscal_condition ||
                ""
            )}`,
            font,
            8.5,
            270
          ),
          {
            x: 285,
            y: headerY - 73,
            size: 8.5,
            font,
          }
        );

        targetPage.drawText(
          `${accountLabel} - ${periodLabel}`,
          {
            x: MARGIN_X,
            y: headerY - 100,
            size: 9.5,
            font: bold,
          }
        );

        if (mode === "range") {
          targetPage.drawText(
            `Saldo anterior al periodo: ${ascii(
              formatMoney(openingBalance)
            )}`,
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

      return headerY - 78;
    }

    function drawTableHeader(
      targetPage: PDFPage,
      tableY: number
    ) {
      const xDate = MARGIN_X;
      const xDocument = 125;
      const xObservation = 215;
      const xDebitRight = 400;
      const xCreditRight = 480;
      const xBalanceRight = 557;

      targetPage.drawRectangle({
        x: MARGIN_X,
        y: tableY - 4,
        width:
          PAGE_WIDTH -
          MARGIN_X * 2,
        height: 20,
        color: rgb(
          0.95,
          0.95,
          0.95
        ),
      });

      targetPage.drawText(
        "FECHA",
        {
          x: xDate,
          y: tableY + 2,
          font: bold,
          size: 7.5,
        }
      );

      targetPage.drawText(
        "COMPROBANTE",
        {
          x: xDocument,
          y: tableY + 2,
          font: bold,
          size: 7.5,
        }
      );

      targetPage.drawText(
        "OBSERVACIONES",
        {
          x: xObservation,
          y: tableY + 2,
          font: bold,
          size: 7.5,
        }
      );

      drawRightText(
        targetPage,
        "DEBE",
        xDebitRight,
        tableY + 2,
        bold,
        7.5
      );

      drawRightText(
        targetPage,
        "HABER",
        xCreditRight,
        tableY + 2,
        bold,
        7.5
      );

      drawRightText(
        targetPage,
        "SALDO",
        xBalanceRight,
        tableY + 2,
        bold,
        7.5
      );

      return tableY - 17;
    }

    y = drawHeader(page);
    y = drawTableHeader(page, y);

    if (rows.length === 0) {
      page.drawText(
        "No hay movimientos en el periodo seleccionado.",
        {
          x: MARGIN_X,
          y,
          size: 10,
          font,
        }
      );
    } else {
      for (const row of rows) {
        if (y < MARGIN_BOTTOM + 22) {
          page = pdfDoc.addPage([
            PAGE_WIDTH,
            PAGE_HEIGHT,
          ]);

          y = drawHeader(
            page,
            true
          );

          y = drawTableHeader(
            page,
            y
          );
        }

        page.drawText(
          truncateText(
            row.date,
            font,
            7.3,
            80
          ),
          {
            x: MARGIN_X,
            y,
            size: 7.3,
            font,
          }
        );

        page.drawText(
          truncateText(
            row.document,
            font,
            7.3,
            82
          ),
          {
            x: 125,
            y,
            size: 7.3,
            font,
          }
        );

        page.drawText(
          truncateText(
            row.observations || "-",
            font,
            7.3,
            105
          ),
          {
            x: 215,
            y,
            size: 7.3,
            font,
          }
        );

        drawRightText(
          page,
          row.debit !== 0
            ? formatMoney(row.debit)
            : "$ 0,00",
          400,
          y,
          font,
          7.1
        );

        drawRightText(
          page,
          row.credit !== 0
            ? formatMoney(row.credit)
            : "$ 0,00",
          480,
          y,
          font,
          7.1
        );

        drawRightText(
          page,
          formatMoney(row.balance),
          557,
          y,
          font,
          7.1
        );

        y -= 15;
      }
    }

    if (y < MARGIN_BOTTOM + 45) {
      page = pdfDoc.addPage([
        PAGE_WIDTH,
        PAGE_HEIGHT,
      ]);

      y = drawHeader(
        page,
        true
      );
    }

    page.drawLine({
      start: {
        x: 355,
        y: y - 2,
      },
      end: {
        x: 557,
        y: y - 2,
      },
      thickness: 0.8,
      color: rgb(
        0.7,
        0.7,
        0.7
      ),
    });

    page.drawText(
      "Saldo final:",
      {
        x: 390,
        y: y - 19,
        size: 9,
        font: bold,
      }
    );

    drawRightText(
      page,
      formatMoney(finalBalance),
      557,
      y - 19,
      bold,
      9.5
    );

    const pageCount =
      pdfDoc.getPageCount();

    pdfDoc
      .getPages()
      .forEach(
        (pdfPage, index) => {
          pdfPage.drawText(
            `Pagina ${index + 1} de ${pageCount}`,
            {
              x: PAGE_WIDTH - 105,
              y: 20,
              size: 7,
              font,
              color: rgb(
                0.45,
                0.45,
                0.45
              ),
            }
          );
        }
      );

    const pdfBytes =
      await pdfDoc.save();

    const accountFile =
      account === "white"
        ? "CuentaCorriente"
        : "Cuenta2";

    const periodFile =
      mode === "full"
        ? "HistorialCompleto"
        : `${from}_${to}`;

    const fileName =
      `Resumen_${String(
        safeCustomer.erp_id
      ).padStart(
        5,
        "0"
      )}_${sanitizeFileName(
        customerName
      )}_${accountFile}_${periodFile}.pdf`;

    return new NextResponse(
      Buffer.from(pdfBytes),
      {
        status: 200,
        headers: {
          "Content-Type":
            "application/pdf",
          "Content-Disposition":
            `attachment; filename="${fileName}"`,
          "Cache-Control":
            "no-store",
        },
      }
    );
  } catch (error) {
    console.error(
      "Error generando resumen de cuenta:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo generar el resumen de cuenta.",
      },
      { status: 500 }
    );
  }
}
