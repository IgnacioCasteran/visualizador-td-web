import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    invoice_id: string;
  }>;
};

type InvoiceItem = {
  erp_id: number;
  invoice_id: number;
  article_id: number | string | null;
  article_code: string | null;
  description: string | null;
  quantity: number | string | null;
  unit_price: number | string | null;
  discount_percentage: number | string | null;
  iva_percentage: number | string | null;
};

const COMPANY = {
  name: "NUIN CARLOS ALBERTO",
  businessName: "Nuin Carlos Alberto",
  cuit: "20-08010697-2",
  address: "Calle 26 N° 657 ,General Pico,La Pampa",
  phone: "(02302) 422673/424692",
  email: "carlosnuin@gmail.com",
  fiscalCondition: "IVA Responsable Inscripto",
  activityStart: "01/1996",
  grossIncome: "178052-5",
};

function formatMoney(value: number | string | null | undefined) {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatQuantity(value: number | string | null | undefined) {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatPercentage(value: number | string | null | undefined) {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value));
}

function formatCuit(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");

  if (digits.length !== 11) {
    return String(value ?? "").trim();
  }

  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function paymentMethodLabel(value: number | null | undefined) {
  switch (Number(value)) {
    case 1:
      return "CONTADO";
    case 4:
      return "CTA. CTE";
    default:
      return value === null || value === undefined
        ? "-"
        : `FORMA ${value}`;
  }
}

function fiscalConditionLabel(value: string | null | undefined) {
  const text = String(value ?? "").trim().toUpperCase();

  if (!text) return "-";

  if (text.includes("MONOTRIBUTO")) {
    return "RESP. MONOTRIBUTO";
  }

  if (text.includes("RESPONSABLE") && text.includes("INSCRIPTO")) {
    return "RESP. INSCRIPTO";
  }

  return text;
}

function getDocumentInfo(documentType: number | null | undefined) {
  switch (Number(documentType)) {
    case 1:
      return {
        title: "Factura",
        filenamePrefix: "FC",
        afipCode: "01",
      };

    case 2:
      return {
        title: "Nota de Crédito",
        filenamePrefix: "NC",
        afipCode: "03",
      };

    case 6:
      return {
        title: "Nota de Débito",
        filenamePrefix: "ND",
        afipCode: "02",
      };

    case 66:
      return {
        title: "Factura",
        filenamePrefix: "FCX",
        afipCode: "",
      };

    case 68:
      return {
        title: "Nota de Crédito",
        filenamePrefix: "NCX",
        afipCode: "",
      };

    case 69:
      return {
        title: "Nota de Débito",
        filenamePrefix: "NDX",
        afipCode: "",
      };

    case 3:
      return {
        title: "Presupuesto",
        filenamePrefix: "PRE",
        afipCode: "",
      };

    case 4:
      return {
        title: "Pedido",
        filenamePrefix: "PED",
        afipCode: "",
      };

    default:
      return {
        title: "Comprobante",
        filenamePrefix: "DOC",
        afipCode: "",
      };
  }
}

function lineSubtotal(item: InvoiceItem) {
  const quantity = Number(item.quantity ?? 0);
  const unitPrice = Number(item.unit_price ?? 0);
  const discountPercentage = Number(item.discount_percentage ?? 0);

  const gross = quantity * unitPrice;
  return gross - gross * (discountPercentage / 100);
}


function getCuenta2DocumentNumber(
  value: number | string | null | undefined
) {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return numeric >= 300000000
    ? numeric - 300000000
    : numeric;
}

function sanitizeFilename(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fitText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
) {
  const normalized = String(text ?? "").trim();

  if (!normalized) return "";

  if (font.widthOfTextAtSize(normalized, fontSize) <= maxWidth) {
    return normalized;
  }

  let result = normalized;

  while (
    result.length > 1 &&
    font.widthOfTextAtSize(`${result}...`, fontSize) > maxWidth
  ) {
    result = result.slice(0, -1);
  }

  return `${result.trimEnd()}...`;
}

function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
) {
  const words = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }

    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

export async function GET(
  _request: Request,
  { params }: RouteContext
) {
  try {
    const { invoice_id } = await params;
    const invoiceId = Number(invoice_id);

    if (!Number.isFinite(invoiceId)) {
      return NextResponse.json(
        { error: "ID de comprobante inválido." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "No autorizado." },
        { status: 401 }
      );
    }

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
        taxed_amount_105,
        discount,
        observations,
        cae,
        cancelled,
        payment_method_id,
        point_of_sale
      `)
      .eq("erp_id", invoiceId)
      .maybeSingle();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        {
          error:
            invoiceError?.message ||
            "No se encontró el comprobante.",
        },
        { status: 404 }
      );
    }

    const customerId = Number(invoice.customer_id);

    const { data: customer } = await supabase
      .from("customers")
      .select(`
        erp_id,
        business_name,
        name,
        cuit,
        address,
        locality_name,
        fiscal_condition
      `)
      .eq("erp_id", customerId)
      .maybeSingle();

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

    if (itemsError) {
      return NextResponse.json(
        {
          error: `No se pudieron cargar los artículos: ${itemsError.message}`,
        },
        { status: 500 }
      );
    }

    const {
      data: invoiceUser,
    } = await supabase
      .from("article_history")
      .select(`
        user_id,
        user_name
      `)
      .eq("invoice_id", invoiceId)
      .not("user_name", "is", null)
      .limit(1)
      .maybeSingle();

    const createdBy =
      invoiceUser?.user_name?.trim() || "-";

    const document = getDocumentInfo(
      invoice.document_type
    );

    const customerName =
      customer?.business_name ||
      customer?.name ||
      `Cliente ${customerId}`;

    const form = String(invoice.form ?? "")
      .trim()
      .toUpperCase();

    const pointOfSale = Number(
      invoice.point_of_sale ?? 0
    );

    const documentNumber = Number(
      invoice.number ?? 0
    );

    const documentType = Number(
      invoice.document_type ?? 0
    );

    const isCuenta2 =
      documentType === 66 ||
      documentType === 68 ||
      documentType === 69;

    const isCuenta2CreditNote =
      documentType === 68;

    const isBudget =
      documentType === 3;

    const displayPointOfSale =
      isCuenta2 ? 1 : pointOfSale;

    const displayDocumentNumber =
      isCuenta2
        ? getCuenta2DocumentNumber(
            documentNumber
          )
        : documentNumber;

    const formattedNumber =
      `${String(displayPointOfSale).padStart(4, "0")}-` +
      `${String(displayDocumentNumber).padStart(8, "0")}`;

    const safeItems =
      (items ?? []) as InvoiceItem[];

    const pdfDoc = await PDFDocument.create();

    const page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    const regular = await pdfDoc.embedFont(
      StandardFonts.Helvetica
    );

    const bold = await pdfDoc.embedFont(
      StandardFonts.HelveticaBold
    );

    const italic = await pdfDoc.embedFont(
      StandardFonts.HelveticaOblique
    );

    const black = rgb(0, 0, 0);
    const gray = rgb(0.25, 0.25, 0.25);
    const lightGray = rgb(0.75, 0.75, 0.75);

    const left = 18;
    const right = width - 18;
    const contentWidth = right - left;

    const drawText = (
      text: string,
      x: number,
      y: number,
      size = 9,
      useBold = false,
      maxWidth?: number
    ) => {
      const font = useBold ? bold : regular;
      const value =
        maxWidth !== undefined
          ? fitText(text, font, size, maxWidth)
          : text;

      page.drawText(value, {
        x,
        y,
        size,
        font,
        color: black,
      });
    };

    const drawRightText = (
      text: string,
      rightX: number,
      y: number,
      size = 9,
      useBold = false
    ) => {
      const font = useBold ? bold : regular;
      const textWidth = font.widthOfTextAtSize(
        text,
        size
      );

      page.drawText(text, {
        x: rightX - textWidth,
        y,
        size,
        font,
        color: black,
      });
    };

    const drawCenteredText = (
      text: string,
      centerX: number,
      y: number,
      size = 9,
      useBold = false
    ) => {
      const font = useBold ? bold : regular;
      const textWidth = font.widthOfTextAtSize(
        text,
        size
      );

      page.drawText(text, {
        x: centerX - textWidth / 2,
        y,
        size,
        font,
        color: black,
      });
    };


    const drawItalicText = (
      text: string,
      x: number,
      y: number,
      size = 9,
      maxWidth?: number
    ) => {
      const value =
        maxWidth !== undefined
          ? fitText(text, italic, size, maxWidth)
          : text;

      page.drawText(value, {
        x,
        y,
        size,
        font: italic,
        color: black,
      });
    };

    // =========================================================
    // CABECERA SUPERIOR
    // =========================================================

    const topBoxY = height - 142;
    const topBoxHeight = 122;

    page.drawRectangle({
      x: left,
      y: topBoxY,
      width: contentWidth,
      height: topBoxHeight,
      borderColor: black,
      borderWidth: 0.8,
    });

    if (!isCuenta2) {
      // Logo
      try {
        const logoPath = path.join(
          process.cwd(),
          "public",
          "logo.jpg"
        );

        const logoBytes = await fs.readFile(
          logoPath
        );

        const logo = await pdfDoc.embedJpg(
          logoBytes
        );

        const scale = Math.min(
          105 / logo.width,
          39 / logo.height
        );

        page.drawImage(logo, {
          x: 76,
          y: topBoxY + 82,
          width: logo.width * scale,
          height: logo.height * scale,
        });
      } catch (logoError) {
        console.error(
          "No se pudo cargar logo.jpg:",
          logoError
        );
      }

      // Datos empresa - izquierda
      drawCenteredText(
        COMPANY.name,
        150,
        topBoxY + 57,
        11,
        false
      );

      drawCenteredText(
        COMPANY.address,
        132,
        topBoxY + 49,
        9.2
      );

      drawCenteredText(
        `Tel: ${COMPANY.phone}`,
        150,
        topBoxY + 27,
        9.2
      );

      drawCenteredText(
        COMPANY.email,
        150,
        topBoxY + 12,
        9.2
      );

      // Letra
      drawCenteredText(
        form || "-",
        289,
        topBoxY + 91,
        25,
        true
      );

      if (document.afipCode) {
        drawCenteredText(
          document.afipCode,
          289,
          topBoxY + 69,
          10,
          true
        );
      }
    }

    // Datos comprobante - derecha
    const rightInfoX = 362;

    drawText(
      document.title,
      rightInfoX,
      topBoxY + 105,
      12,
      true
    );

    drawText(
      `N° ${formattedNumber}`,
      rightInfoX,
      topBoxY + 88,
      11,
      true
    );

    drawText(
      `Fecha   ${formatDate(invoice.issued_at)}`,
      rightInfoX,
      topBoxY + 67,
      10,
      true
    );

    if (!isCuenta2) {
      drawText(
        `Razón Social: ${COMPANY.businessName}`,
        rightInfoX,
        topBoxY + 49,
        7.8,
        true,
        205
      );

      drawText(
        `CUIT: ${COMPANY.cuit}`,
        rightInfoX,
        topBoxY + 38,
        7.8,
        true
      );

      drawText(
        COMPANY.fiscalCondition,
        rightInfoX,
        topBoxY + 27,
        7.8,
        true
      );

      drawText(
        `Inicio Actividades: ${COMPANY.activityStart}`,
        rightInfoX,
        topBoxY + 16,
        7.8,
        true
      );

      drawText(
        `Ingresos Brutos: ${COMPANY.grossIncome}`,
        rightInfoX,
        topBoxY + 5,
        7.8,
        true
      );
    }

    // =========================================================
    // CLIENTE
    // =========================================================

    const clientBoxY = topBoxY - 78;
    const clientBoxHeight = 79;

    page.drawRectangle({
      x: left,
      y: clientBoxY,
      width: contentWidth,
      height: clientBoxHeight,
      borderColor: black,
      borderWidth: 0.8,
    });

    const labelX = 38;
    const valueX = 118;

    drawText(
      "Señor(es):",
      labelX,
      clientBoxY + 58,
      9
    );

    drawText(
      `(${customerId}) ${customerName}`,
      valueX,
      clientBoxY + 58,
      9,
      false,
      320
    );

    drawText(
      "Domicilio:",
      labelX,
      clientBoxY + 41,
      9
    );

    drawText(
      customer?.address || "-",
      valueX,
      clientBoxY + 41,
      9,
      false,
      245
    );

    drawText(
      "CUIT:",
      350,
      clientBoxY + 41,
      9
    );

    drawText(
      formatCuit(customer?.cuit) || "-",
      397,
      clientBoxY + 41,
      9
    );

    drawText(
      "I.V.A",
      labelX,
      clientBoxY + 24,
      9
    );

    drawText(
      fiscalConditionLabel(
        customer?.fiscal_condition
      ),
      valueX,
      clientBoxY + 24,
      9
    );

    drawText(
      "Condición:",
      350,
      clientBoxY + 24,
      9
    );

    drawText(
      paymentMethodLabel(
        invoice.payment_method_id
      ),
      420,
      clientBoxY + 24,
      9
    );

    drawText(
      "Localidad:",
      labelX,
      clientBoxY + 8,
      9
    );

    drawText(
      customer?.locality_name || "-",
      valueX,
      clientBoxY + 8,
      9
    );

    // =========================================================
    // TABLA DE ARTÍCULOS
    // =========================================================

    const tableTopY = clientBoxY - 22;

    const normalColumns = {
      code: {
        x: 24,
        width: 61,
      },
      description: {
        x: 86,
        width: 257,
      },
      quantity: {
        x: 343,
        width: 49,
      },
      iva: {
        x: 392,
        width: 39,
      },
      unitPrice: {
        x: 431,
        width: 62,
      },
      discount: {
        x: 493,
        width: 39,
      },
      subtotal: {
        x: 532,
        width: 45,
      },
    };

    const cuenta2Columns = {
      code: {
        x: 24,
        width: 61,
      },
      description: {
        x: 86,
        width: 282,
      },
      quantity: {
        x: 368,
        width: 45,
      },
      unitPrice: {
        x: 433,
        width: 62,
      },
      discount: {
        x: 496,
        width: 39,
      },
      subtotal: {
        x: 535,
        width: 42,
      },
    };

    const budgetColumns = {
      code: {
        x: 24,
        width: 61,
      },
      description: {
        x: 86,
        width: 257,
      },
      quantity: {
        x: 343,
        width: 49,
      },
      iva: {
        x: 392,
        width: 39,
      },
      unitPrice: {
        x: 431,
        width: 75,
      },
      subtotal: {
        x: 518,
        width: 59,
      },
    };

    if (isCuenta2) {
      drawText(
        "Código",
        cuenta2Columns.code.x,
        tableTopY,
        8.5
      );

      drawText(
        "Descripción",
        cuenta2Columns.description.x,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "Cant",
        cuenta2Columns.quantity.x +
          cuenta2Columns.quantity.width / 2,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "P. Unit",
        cuenta2Columns.unitPrice.x +
          cuenta2Columns.unitPrice.width / 2,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "Dto",
        cuenta2Columns.discount.x +
          cuenta2Columns.discount.width / 2,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "Subtotal",
        cuenta2Columns.subtotal.x +
          cuenta2Columns.subtotal.width / 2,
        tableTopY,
        8.5
      );
    } else if (isBudget) {
      drawText(
        "Código",
        budgetColumns.code.x,
        tableTopY,
        8.5
      );

      drawText(
        "Descripción",
        budgetColumns.description.x,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "Cantidad",
        budgetColumns.quantity.x +
          budgetColumns.quantity.width / 2,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "IVA",
        budgetColumns.iva.x +
          budgetColumns.iva.width / 2,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "P. Unit",
        budgetColumns.unitPrice.x +
          budgetColumns.unitPrice.width / 2,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "Subtotal",
        budgetColumns.subtotal.x +
          budgetColumns.subtotal.width / 2,
        tableTopY,
        8.5
      );
    } else {
      drawText(
        "Código",
        normalColumns.code.x,
        tableTopY,
        8.5
      );

      drawText(
        "Descripción",
        normalColumns.description.x,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "Cantidad",
        normalColumns.quantity.x +
          normalColumns.quantity.width / 2,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "IVA",
        normalColumns.iva.x +
          normalColumns.iva.width / 2,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "P. Unit",
        normalColumns.unitPrice.x +
          normalColumns.unitPrice.width / 2,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "Dto",
        normalColumns.discount.x +
          normalColumns.discount.width / 2,
        tableTopY,
        8.5
      );

      drawCenteredText(
        "Subtotal",
        normalColumns.subtotal.x +
          normalColumns.subtotal.width / 2,
        tableTopY,
        8.5
      );
    }

    let rowY = tableTopY - 20;

    for (const item of safeItems) {
      if (rowY < 210) {
        break;
      }

      const activeDescriptionWidth =
        isCuenta2
          ? cuenta2Columns.description.width
          : isBudget
            ? budgetColumns.description.width
            : normalColumns.description.width;

      const descriptionLines = wrapText(
        item.description || "-",
        regular,
        7.5,
        activeDescriptionWidth - 6
      ).slice(0, 2);

      const displayQuantity =
        isCuenta2CreditNote
          ? -Math.abs(
              Number(item.quantity ?? 0)
            )
          : Number(item.quantity ?? 0);

      const rawLineSubtotal =
        lineSubtotal(item);

      const displayLineSubtotal =
        isCuenta2CreditNote
          ? -Math.abs(rawLineSubtotal)
          : rawLineSubtotal;

      const activeCode =
        isCuenta2
          ? cuenta2Columns.code
          : isBudget
            ? budgetColumns.code
            : normalColumns.code;

      const activeDescription =
        isCuenta2
          ? cuenta2Columns.description
          : isBudget
            ? budgetColumns.description
            : normalColumns.description;

      drawText(
        item.article_code || "-",
        activeCode.x,
        rowY,
        7.5,
        false,
        activeCode.width - 4
      );

      descriptionLines.forEach(
        (line, index) => {
          drawText(
            line,
            activeDescription.x,
            rowY - index * 9,
            7.5
          );
        }
      );

      if (isCuenta2) {
        drawRightText(
          formatQuantity(displayQuantity),
          cuenta2Columns.quantity.x +
            cuenta2Columns.quantity.width - 4,
          rowY,
          7.5
        );

        drawRightText(
          formatMoney(item.unit_price),
          cuenta2Columns.unitPrice.x +
            cuenta2Columns.unitPrice.width - 4,
          rowY,
          7.5
        );

        drawRightText(
          formatPercentage(
            item.discount_percentage
          ),
          cuenta2Columns.discount.x +
            cuenta2Columns.discount.width - 4,
          rowY,
          7.5
        );

        drawRightText(
          formatMoney(displayLineSubtotal),
          cuenta2Columns.subtotal.x +
            cuenta2Columns.subtotal.width - 1,
          rowY,
          7.1
        );
      } else if (isBudget) {
        drawRightText(
          formatQuantity(item.quantity),
          budgetColumns.quantity.x +
            budgetColumns.quantity.width - 4,
          rowY,
          7.5
        );

        drawRightText(
          formatPercentage(item.iva_percentage),
          budgetColumns.iva.x +
            budgetColumns.iva.width - 4,
          rowY,
          7.5
        );

        drawRightText(
          formatMoney(item.unit_price),
          budgetColumns.unitPrice.x +
            budgetColumns.unitPrice.width - 4,
          rowY,
          7.5
        );

        drawRightText(
          formatMoney(rawLineSubtotal),
          budgetColumns.subtotal.x +
            budgetColumns.subtotal.width - 1,
          rowY,
          7.1
        );
      } else {
        drawRightText(
          formatQuantity(item.quantity),
          normalColumns.quantity.x +
            normalColumns.quantity.width - 4,
          rowY,
          7.5
        );

        drawRightText(
          formatPercentage(item.iva_percentage),
          normalColumns.iva.x +
            normalColumns.iva.width - 4,
          rowY,
          7.5
        );

        drawRightText(
          formatMoney(item.unit_price),
          normalColumns.unitPrice.x +
            normalColumns.unitPrice.width - 4,
          rowY,
          7.5
        );

        drawRightText(
          formatPercentage(
            item.discount_percentage
          ),
          normalColumns.discount.x +
            normalColumns.discount.width - 4,
          rowY,
          7.5
        );

        drawRightText(
          formatMoney(rawLineSubtotal),
          normalColumns.subtotal.x +
            normalColumns.subtotal.width - 1,
          rowY,
          7.1
        );
      }

      rowY -=
        descriptionLines.length > 1
          ? 25
          : 18;
    }

    // =========================================================
    // OBSERVACIONES
    // =========================================================

    const observationsY = 183;

    drawText(
      "Observaciones:",
      left + 8,
      observationsY,
      8.5,
      true
    );

    const isMonotributo =
      String(customer?.fiscal_condition ?? "")
        .toUpperCase()
        .includes("MONOTRIBUTO");

    const fixedMonotributoNote =
      "El crédito fiscal discriminado en el presente comprobante, solo podrá ser computado a efectos del Régimen de Sostenimiento e inclusión fiscal para pequeños contribuyentes de la ley N° 27.618";

    const explicitObservation =
      String(invoice.observations ?? "").trim();

    const observationText =
      isCuenta2
        ? explicitObservation
        : explicitObservation ||
          (isMonotributo
            ? fixedMonotributoNote
            : "");


    if (observationText) {
      const observationLines = wrapText(
        observationText,
        regular,
        6.9,
        contentWidth - 16
      ).slice(0, 2);

      observationLines.forEach(
        (line: string, index: number) => {
          drawText(
            line,
            left + 8,
            observationsY - 13 - index * 8,
            6.9
          );
        }
      );
    }

    // =========================================================
    // TOTALES
    // =========================================================

    const totalsY = 88;
    const totalsHeight = 58;
    const totalsX = left + 8;
    const totalsWidth = contentWidth - 16;
    const totalColumns = 6;
    const totalColumnWidth =
      totalsWidth / totalColumns;

    const totalHeaders = isCuenta2
      ? [
          "Neto",
          "Descuento",
          "SubTotal",
          "IVA 21%",
          "",
          "TOTAL",
        ]
      : [
          "Neto",
          "Descuento",
          "SubTotal",
          "IVA 21%",
          "IVA 10,5%",
          "TOTAL",
        ];

    const subtotal =
      Number(invoice.net_amount ?? 0);

    const cuenta2NetAmount =
      isCuenta2CreditNote
        ? -Math.abs(
            Number(invoice.net_amount ?? 0)
          )
        : Number(invoice.net_amount ?? 0);

    const cuenta2Tax21 =
      isCuenta2CreditNote
        ? -Math.abs(
            Number(invoice.taxed_amount_21 ?? 0)
          )
        : Number(invoice.taxed_amount_21 ?? 0);

    const cuenta2SignedTotal =
      isCuenta2CreditNote
        ? -Math.abs(
            Number(invoice.total ?? 0)
          )
        : Number(invoice.total ?? 0);

    const totalValues = isCuenta2
      ? [
          `$ ${formatMoney(cuenta2NetAmount)}`,
          Number(invoice.discount ?? 0) === 0
            ? "0"
            : new Intl.NumberFormat("es-AR", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              }).format(Number(invoice.discount ?? 0)),
          `$ ${formatMoney(cuenta2NetAmount)}`,
          `$ ${formatMoney(cuenta2Tax21)}`,
          "",
          `$ ${formatMoney(cuenta2SignedTotal)}`,
        ]
      : [
          `$ ${formatMoney(invoice.net_amount)}`,
          Number(invoice.discount ?? 0) === 0
            ? "0"
            : new Intl.NumberFormat("es-AR", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              }).format(Number(invoice.discount ?? 0)),
          `$ ${formatMoney(subtotal)}`,
          `$ ${formatMoney(invoice.taxed_amount_21)}`,
          `$ ${formatMoney(invoice.taxed_amount_105)}`,
          `$ ${formatMoney(invoice.total)}`,
        ];

    page.drawRectangle({
      x: totalsX,
      y: totalsY,
      width: totalsWidth,
      height: totalsHeight,
      borderColor: black,
      borderWidth: 0.7,
    });

    page.drawLine({
      start: {
        x: totalsX,
        y: totalsY + 26,
      },
      end: {
        x: totalsX + totalsWidth,
        y: totalsY + 26,
      },
      thickness: 0.7,
      color: black,
    });

    for (
      let index = 1;
      index < totalColumns;
      index++
    ) {
      page.drawLine({
        start: {
          x:
            totalsX +
            totalColumnWidth * index,
          y: totalsY,
        },
        end: {
          x:
            totalsX +
            totalColumnWidth * index,
          y: totalsY + totalsHeight,
        },
        thickness: 0.7,
        color: black,
      });
    }

    totalHeaders.forEach(
      (header, index) => {
        drawCenteredText(
          header,
          totalsX +
            totalColumnWidth * index +
            totalColumnWidth / 2,
          totalsY + 39,
          9.2,
          true
        );
      }
    );

    totalValues.forEach(
      (value, index) => {
        drawCenteredText(
          value,
          totalsX +
            totalColumnWidth * index +
            totalColumnWidth / 2,
          totalsY + 11,
          10.2,
          true
        );
      }
    );

    // Pie
    drawText(
      "Confeccionó:",
      totalsX + 6,
      totalsY - 14,
      8.2,
      true
    );

    drawText(
      createdBy,
      totalsX + 75,
      totalsY - 14,
      8.2,
      true,
      90
    );

    if (!isCuenta2) {
      drawText(
        "Fecha de Vto:",
        totalsX + 250,
        totalsY - 14,
        8.2,
        true
      );

      drawText(
        formatDate(invoice.due_at) || "-",
        totalsX + 323,
        totalsY - 14,
        8.2,
        true
      );

      drawText(
        "CAE.N°:",
        totalsX + 385,
        totalsY - 14,
        8.2,
        true
      );

      drawText(
        String(invoice.cae ?? "").trim() || "-",
        totalsX + 430,
        totalsY - 14,
        8.2,
        true
      );
    }

    if (invoice.cancelled) {
      page.drawText("ANULADO", {
        x: width / 2 - 80,
        y: height / 2,
        size: 38,
        font: bold,
        color: rgb(0.8, 0.8, 0.8),
        rotate: degrees(35),
      });
    }

    const pdfBytes = await pdfDoc.save();

    const filenameDocumentNumber =
      isCuenta2
        ? displayDocumentNumber
        : documentNumber;

    const rawFilename =
      `${document.filenamePrefix}${form}${filenameDocumentNumber}` +
      `_(${customerId}) ${customerName}.pdf`;

    const filename =
      sanitizeFilename(rawFilename);

    return new Response(
      Buffer.from(pdfBytes),
      {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition":
            `attachment; filename="${filename}"`,
          "Cache-Control":
            "private, no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error(
      "Error generando PDF:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error inesperado generando PDF.",
      },
      {
        status: 500,
      }
    );
  }
}
