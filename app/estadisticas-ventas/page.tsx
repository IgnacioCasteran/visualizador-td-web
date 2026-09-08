"use client";

import {
    FormEvent,
    useEffect,
    useMemo,
    useState,
} from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase/client";
import LoadingOverlay from "@/components/LoadingOverlay";
import AppNavbar from "@/components/AppNavbar";

type PeriodPreset =
    | "7d"
    | "30d"
    | "month"
    | "previousMonth"
    | "range";

type SaleHistoryRow = {
    erp_row_id: number;
    article_id: number | null;
    article_code: string | null;
    article_name: string | null;
    customer_id: number | null;
    customer_name: string | null;
    document_type: number | null;
    issued_at: string | null;
    quantity: number | string | null;
    unit_price: number | string | null;
    discount_percentage: number | string | null;
};

type ArticleRow = {
    erp_id: number;
    code: string | null;
    name: string | null;
    brand_id: number | null;
};

type BrandRow = {
    erp_id: number;
    name: string | null;
    prefix: string | null;
};

type ArticleSuggestion = {
    erp_id: number;
    code: string | null;
    name: string | null;
    brand_id: number | null;
};

type CustomerSuggestion = {
    erp_id: number;
    name: string | null;
    zone: string | null;
};

type ZoneStat = {
    zone: string;
    units: number;
    amount: number;
    products: number;
    customers: number;
};

type ProductStat = {
    articleId: number;
    code: string;
    name: string;
    brandId: number | null;
    brandName: string;
    units: number;
    amount: number;
    grossSales: number;
    creditNotes: number;
    operations: number;
    lastSale: string | null;
};

type BrandStat = {
    brandId: number | null;
    name: string;
    units: number;
    amount: number;
    products: number;
};

const SALES_DOCUMENT_TYPES = [1, 2, 66, 68];
const INVOICE_TYPES = new Set([1, 66]);
const CREDIT_NOTE_TYPES = new Set([2, 68]);
const PAGE_BATCH = 1000;
const DETAIL_PAGE_SIZE = 50;

function formatMoney(
    value: number | string | null | undefined
) {
    return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number(value ?? 0));
}

function formatQuantity(
    value: number | string | null | undefined
) {
    const numeric = Number(value ?? 0);

    return new Intl.NumberFormat("es-AR", {
        minimumFractionDigits: Number.isInteger(numeric)
            ? 0
            : 2,
        maximumFractionDigits: 2,
    }).format(numeric);
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

function toInputDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function argentinaStartUtc(date: string) {
    return new Date(
        `${date}T00:00:00-03:00`
    ).toISOString();
}

function argentinaNextDayUtc(date: string) {
    const local = new Date(
        `${date}T00:00:00-03:00`
    );

    local.setUTCDate(local.getUTCDate() + 1);
    return local.toISOString();
}

function sanitizePostgrestValue(value: string) {
    return value
        .replaceAll(",", " ")
        .replaceAll("(", " ")
        .replaceAll(")", " ")
        .trim();
}

function sanitizeFilePart(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60);
}

function compareZones(a: string, b: string) {
    const aNumber = Number.parseFloat(
        a.replace(",", ".")
    );
    const bNumber = Number.parseFloat(
        b.replace(",", ".")
    );

    const aIsNumber =
        Number.isFinite(aNumber);
    const bIsNumber =
        Number.isFinite(bNumber);

    if (aIsNumber && bIsNumber) {
        return aNumber - bNumber;
    }

    if (aIsNumber) return -1;
    if (bIsNumber) return 1;

    return a.localeCompare(b, "es", {
        numeric: true,
        sensitivity: "base",
    });
}

function getPresetRange(
    preset: Exclude<PeriodPreset, "range">
) {
    const now = new Date();

    if (preset === "7d") {
        const from = new Date(now);
        from.setDate(from.getDate() - 6);

        return {
            from: toInputDate(from),
            to: toInputDate(now),
        };
    }

    if (preset === "30d") {
        const from = new Date(now);
        from.setDate(from.getDate() - 29);

        return {
            from: toInputDate(from),
            to: toInputDate(now),
        };
    }

    if (preset === "previousMonth") {
        const firstCurrentMonth = new Date(
            now.getFullYear(),
            now.getMonth(),
            1
        );

        const firstPreviousMonth = new Date(
            now.getFullYear(),
            now.getMonth() - 1,
            1
        );

        const lastPreviousMonth = new Date(
            firstCurrentMonth.getTime() - 86400000
        );

        return {
            from: toInputDate(firstPreviousMonth),
            to: toInputDate(lastPreviousMonth),
        };
    }

    return {
        from: toInputDate(
            new Date(
                now.getFullYear(),
                now.getMonth(),
                1
            )
        ),
        to: toInputDate(now),
    };
}

function lineAmount(row: SaleHistoryRow) {
    const quantity = Math.abs(
        Number(row.quantity ?? 0)
    );
    const price = Number(row.unit_price ?? 0);
    const discount = Number(
        row.discount_percentage ?? 0
    );

    const gross = quantity * price;

    return Math.abs(
        gross - gross * (discount / 100)
    );
}

function StatCard({
    label,
    value,
    helper,
}: {
    label: string;
    value: string;
    helper: string;
}) {
    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {label}
            </p>

            <p className="mt-2 text-2xl font-extrabold text-gray-900">
                {value}
            </p>

            <p className="mt-1 text-sm text-gray-500">
                {helper}
            </p>
        </div>
    );
}

export default function SalesStatisticsPage() {
    const initialRange = getPresetRange("30d");

    const [period, setPeriod] =
        useState<PeriodPreset>("30d");
    const [fromDate, setFromDate] =
        useState(initialRange.from);
    const [toDate, setToDate] =
        useState(initialRange.to);

    const [brandFilter, setBrandFilter] =
        useState("all");
    const [zoneFilter, setZoneFilter] =
        useState("all");
    const [articleSearch, setArticleSearch] =
        useState("");
    const [
        selectedArticleId,
        setSelectedArticleId,
    ] = useState<number | null>(null);

    const [customerSearch, setCustomerSearch] =
        useState("");
    const [
        selectedCustomerId,
        setSelectedCustomerId,
    ] = useState<number | null>(null);

    // Filtros realmente aplicados a los resultados.
    // Los campos de arriba son solo "borrador" mientras el usuario escribe.
    const [
        appliedBrandFilter,
        setAppliedBrandFilter,
    ] = useState("all");
    const [
        appliedZoneFilter,
        setAppliedZoneFilter,
    ] = useState("all");
    const [
        appliedArticleSearch,
        setAppliedArticleSearch,
    ] = useState("");
    const [
        appliedArticleId,
        setAppliedArticleId,
    ] = useState<number | null>(null);
    const [
        appliedCustomerId,
        setAppliedCustomerId,
    ] = useState<number | null>(null);
    const [
        appliedCustomerSearch,
        setAppliedCustomerSearch,
    ] = useState("");
    const [
        appliedFromDate,
        setAppliedFromDate,
    ] = useState(initialRange.from);
    const [
        appliedToDate,
        setAppliedToDate,
    ] = useState(initialRange.to);
    const [zones, setZones] =
        useState<string[]>([]);

    const [
        articleSuggestions,
        setArticleSuggestions,
    ] = useState<ArticleSuggestion[]>([]);
    const [
        customerSuggestions,
        setCustomerSuggestions,
    ] = useState<CustomerSuggestion[]>([]);
    const [
        showArticleSuggestions,
        setShowArticleSuggestions,
    ] = useState(false);
    const [
        showCustomerSuggestions,
        setShowCustomerSuggestions,
    ] = useState(false);
    const [
        articleSuggestionsLoading,
        setArticleSuggestionsLoading,
    ] = useState(false);
    const [
        customerSuggestionsLoading,
        setCustomerSuggestionsLoading,
    ] = useState(false);

    const [
        analyzedRows,
        setAnalyzedRows,
    ] = useState<SaleHistoryRow[]>([]);

    const [brands, setBrands] =
        useState<BrandRow[]>([]);
    const [products, setProducts] =
        useState<ProductStat[]>([]);
    const [loading, setLoading] =
        useState(false);
    const [error, setError] =
        useState<string | null>(null);

    const [detailPage, setDetailPage] =
        useState(1);

    const [lastSync, setLastSync] =
        useState<string | null>(null);
    const [loggedUsername, setLoggedUsername] =
        useState("");

    useEffect(() => {
        loadBaseData();
        runStatistics(
            initialRange.from,
            initialRange.to,
            null,
            "",
            "all",
            ""
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadBaseData() {
        const [
            syncResult,
            userResult,
            brandResult,
            zoneResult,
        ] = await Promise.all([
            supabase
                .from("sync_status")
                .select(`
                    last_completed_at,
                    success
                `)
                .eq(
                    "sync_name",
                    "sincronizacion_incremental"
                )
                .maybeSingle(),
            supabase.auth.getUser(),
            supabase
                .from("brands")
                .select(`
                    erp_id,
                    name,
                    prefix
                `)
                .order("name", {
                    ascending: true,
                }),
            supabase
                .from("customers")
                .select("zone")
                .not("zone", "is", null)
                .limit(10000),
        ]);

        if (
            syncResult.data?.success === true &&
            syncResult.data?.last_completed_at
        ) {
            setLastSync(
                syncResult.data.last_completed_at
            );
        }

        const email =
            userResult.data.user?.email ?? "";

        setLoggedUsername(
            email ? email.split("@")[0] : ""
        );

        if (!brandResult.error) {
            const sortedBrands = (
                (brandResult.data ??
                    []) as BrandRow[]
            ).sort((a, b) => {
                const aPrefix =
                    Number.parseInt(
                        String(a.prefix ?? "").replace(
                            /\D/g,
                            ""
                        ),
                        10
                    );

                const bPrefix =
                    Number.parseInt(
                        String(b.prefix ?? "").replace(
                            /\D/g,
                            ""
                        ),
                        10
                    );

                const safeA =
                    Number.isFinite(aPrefix)
                        ? aPrefix
                        : 999999;

                const safeB =
                    Number.isFinite(bPrefix)
                        ? bPrefix
                        : 999999;

                return (
                    safeA - safeB ||
                    String(a.name ?? "").localeCompare(
                        String(b.name ?? ""),
                        "es"
                    )
                );
            });

            setBrands(sortedBrands);
        }

        if (!zoneResult.error) {
            const uniqueZones = Array.from(
                new Set(
                    (zoneResult.data ?? [])
                        .map((row) =>
                            String(
                                row.zone ?? ""
                            ).trim()
                        )
                        .filter(Boolean)
                )
            ).sort(compareZones);

            setZones(uniqueZones);
        }
    }

    // Autocomplete liviano: solo trae hasta 10 opciones y NO recalcula estadísticas.
    useEffect(() => {
        const value = articleSearch.trim();

        if (
            selectedArticleId !== null ||
            value.length < 2
        ) {
            setArticleSuggestions([]);
            return;
        }

        const timeout = setTimeout(() => {
            loadArticleSuggestions(
                value,
                brandFilter
            );
        }, 350);

        return () => clearTimeout(timeout);
    }, [
        articleSearch,
        selectedArticleId,
        brandFilter,
    ]);

    async function loadArticleSuggestions(
        value: string,
        currentBrandFilter: string
    ) {
        setArticleSuggestionsLoading(true);

        const safeValue =
            sanitizePostgrestValue(value);
        const numericValue =
            Number(safeValue);

        let query = supabase
            .from("articles")
            .select(`
                erp_id,
                code,
                name,
                brand_id
            `)
            .eq("active", true);

        const filters = [
            `code.ilike.%${safeValue}%`,
            `name.ilike.%${safeValue}%`,
        ];

        if (!Number.isNaN(numericValue)) {
            filters.push(
                `erp_id.eq.${numericValue}`
            );
        }

        query = query.or(filters.join(","));

        if (currentBrandFilter !== "all") {
            query = query.eq(
                "brand_id",
                Number(currentBrandFilter)
            );
        }

        const { data, error } = await query
            .order("code", {
                ascending: true,
            })
            .limit(10);

        if (error) {
            console.error(
                "Error buscando artículos:",
                error
            );
            setArticleSuggestions([]);
            setArticleSuggestionsLoading(false);
            return;
        }

        setArticleSuggestions(
            (data ?? []) as ArticleSuggestion[]
        );
        setArticleSuggestionsLoading(false);
    }

    useEffect(() => {
        const value = customerSearch.trim();

        if (
            selectedCustomerId !== null ||
            value.length < 2
        ) {
            setCustomerSuggestions([]);
            return;
        }

        const timeout = setTimeout(() => {
            loadCustomerSuggestions(
                value,
                zoneFilter
            );
        }, 350);

        return () => clearTimeout(timeout);
    }, [
        customerSearch,
        selectedCustomerId,
        zoneFilter,
    ]);

    async function loadCustomerSuggestions(
        value: string,
        currentZoneFilter: string
    ) {
        setCustomerSuggestionsLoading(true);

        const safeValue =
            sanitizePostgrestValue(value);
        const numericValue =
            Number(safeValue);

        let query = supabase
            .from("customers")
            .select(`
                erp_id,
                name,
                zone
            `);

        const filters = [
            `name.ilike.%${safeValue}%`,
        ];

        if (!Number.isNaN(numericValue)) {
            filters.push(
                `erp_id.eq.${numericValue}`
            );
        }

        query = query.or(filters.join(","));

        if (currentZoneFilter !== "all") {
            query = query.eq(
                "zone",
                currentZoneFilter
            );
        }

        const { data, error } = await query
            .order("name", {
                ascending: true,
            })
            .limit(10);

        if (error) {
            console.error(
                "Error buscando clientes:",
                error
            );
            setCustomerSuggestions([]);
            setCustomerSuggestionsLoading(false);
            return;
        }

        setCustomerSuggestions(
            (data ?? []) as CustomerSuggestion[]
        );
        setCustomerSuggestionsLoading(false);
    }

    async function fetchCustomerIdsByZone(
        zoneValue: string
    ) {
        if (zoneValue === "all") {
            return null;
        }

        const ids: number[] = [];
        let offset = 0;

        while (true) {
            const { data, error } = await supabase
                .from("customers")
                .select("erp_id")
                .eq("zone", zoneValue)
                .order("erp_id", {
                    ascending: true,
                })
                .range(
                    offset,
                    offset + 999
                );

            if (error) {
                throw error;
            }

            const batch = data ?? [];

            ids.push(
                ...batch
                    .map((row) =>
                        Number(row.erp_id)
                    )
                    .filter(
                        (id) =>
                            Number.isFinite(id) &&
                            id > 0
                    )
            );

            if (batch.length < 1000) {
                break;
            }

            offset += 1000;
        }

        return ids;
    }

    async function fetchSalesRows(
        from: string,
        to: string,
        customerId: number | null,
        customerText: string,
        zoneValue: string,
        articleId: number | null,
        articleText: string
    ) {
        const result: SaleHistoryRow[] = [];

        const zoneCustomerIds =
            customerId === null
                ? await fetchCustomerIdsByZone(
                      zoneValue
                  )
                : null;

        if (
            zoneCustomerIds !== null &&
            zoneCustomerIds.length === 0
        ) {
            return result;
        }

        const customerChunks =
            zoneCustomerIds === null
                ? [null]
                : Array.from(
                      {
                          length: Math.ceil(
                              zoneCustomerIds.length /
                                  150
                          ),
                      },
                      (_, index) =>
                          zoneCustomerIds.slice(
                              index * 150,
                              index * 150 + 150
                          )
                  );

        for (const customerChunk of customerChunks) {
            let offset = 0;

            while (true) {
                let query = supabase
                .from("article_history")
                .select(`
                    erp_row_id,
                    article_id,
                    article_code,
                    article_name,
                    customer_id,
                    customer_name,
                    document_type,
                    issued_at,
                    quantity,
                    unit_price,
                    discount_percentage
                `)
                .in(
                    "document_type",
                    SALES_DOCUMENT_TYPES
                )
                .gte(
                    "issued_at",
                    argentinaStartUtc(from)
                )
                .lt(
                    "issued_at",
                    argentinaNextDayUtc(to)
                );

                if (customerId !== null) {
                    query = query.eq(
                        "customer_id",
                        customerId
                    );
                } else {
                    if (
                        customerChunk !== null
                    ) {
                        query = query.in(
                            "customer_id",
                            customerChunk
                        );
                    }

                    if (
                        customerText.trim()
                    ) {
                        const safeCustomer =
                            sanitizePostgrestValue(
                                customerText
                            );

                        const numericCustomer =
                            Number(safeCustomer);

                        if (
                            !Number.isNaN(
                                numericCustomer
                            )
                        ) {
                            query = query.eq(
                                "customer_id",
                                numericCustomer
                            );
                        } else {
                            query = query.ilike(
                                "customer_name",
                                `%${safeCustomer}%`
                            );
                        }
                    }
                }

                if (articleId !== null) {
                    query = query.eq(
                        "article_id",
                        articleId
                    );
                } else if (
                    articleText.trim()
                ) {
                    const safeArticle =
                        sanitizePostgrestValue(
                            articleText
                        );
                    const numericArticle =
                        Number(safeArticle);

                    if (
                        !Number.isNaN(
                            numericArticle
                        )
                    ) {
                        query = query.or(
                            [
                                `article_id.eq.${numericArticle}`,
                                `article_code.ilike.%${safeArticle}%`,
                            ].join(",")
                        );
                    } else {
                        query = query.or(
                            [
                                `article_code.ilike.%${safeArticle}%`,
                                `article_name.ilike.%${safeArticle}%`,
                            ].join(",")
                        );
                    }
                }

                const { data, error } = await query
                .order("issued_at", {
                    ascending: true,
                })
                .range(
                    offset,
                    offset + PAGE_BATCH - 1
                );

            if (error) {
                throw error;
            }

            const batch =
                (data ?? []) as SaleHistoryRow[];

                result.push(...batch);

                if (
                    batch.length <
                    PAGE_BATCH
                ) {
                    break;
                }

                offset += PAGE_BATCH;
            }
        }

        result.sort((a, b) =>
            String(a.issued_at ?? "").localeCompare(
                String(b.issued_at ?? "")
            )
        );

        return result;
    }

    async function fetchArticles(
        ids: number[]
    ) {
        const result: ArticleRow[] = [];

        for (
            let index = 0;
            index < ids.length;
            index += 400
        ) {
            const chunk = ids.slice(
                index,
                index + 400
            );

            const { data, error } = await supabase
                .from("articles")
                .select(`
                    erp_id,
                    code,
                    name,
                    brand_id
                `)
                .in("erp_id", chunk);

            if (error) {
                throw error;
            }

            result.push(
                ...((data ??
                    []) as ArticleRow[])
            );
        }

        return result;
    }

    async function runStatistics(
        fromOverride?: string,
        toOverride?: string,
        customerIdOverride?: number | null,
        customerSearchOverride?: string,
        brandFilterOverride?: string,
        articleSearchOverride?: string,
        zoneFilterOverride?: string,
        articleIdOverride?: number | null
    ) {
        const from = fromOverride ?? fromDate;
        const to = toOverride ?? toDate;

        const customerId =
            customerIdOverride !== undefined
                ? customerIdOverride
                : selectedCustomerId;

        const customerText =
            customerSearchOverride !== undefined
                ? customerSearchOverride
                : customerSearch;

        const brandValue =
            brandFilterOverride !== undefined
                ? brandFilterOverride
                : brandFilter;

        const articleValue =
            articleSearchOverride !== undefined
                ? articleSearchOverride
                : articleSearch;

        const zoneValue =
            zoneFilterOverride !== undefined
                ? zoneFilterOverride
                : zoneFilter;

        const articleId =
            articleIdOverride !== undefined
                ? articleIdOverride
                : selectedArticleId;

        if (!from || !to) {
            setError(
                "Seleccioná una fecha desde y una fecha hasta."
            );
            return;
        }

        if (from > to) {
            setError(
                "La fecha desde no puede ser posterior a la fecha hasta."
            );
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const salesRows =
                await fetchSalesRows(
                    from,
                    to,
                    customerId,
                    customerText,
                    zoneValue,
                    articleId,
                    articleValue
                );

            const articleIds = Array.from(
                new Set(
                    salesRows
                        .map((row) =>
                            Number(row.article_id)
                        )
                        .filter(
                            (id) =>
                                Number.isFinite(id) &&
                                id > 0
                        )
                )
            );

            const articleRows =
                articleIds.length > 0
                    ? await fetchArticles(
                          articleIds
                      )
                    : [];

            const articleMap = new Map<
                number,
                ArticleRow
            >();

            for (const article of articleRows) {
                articleMap.set(
                    Number(article.erp_id),
                    article
                );
            }

            const brandMap = new Map<
                number,
                BrandRow
            >();

            for (const brand of brands) {
                brandMap.set(
                    Number(brand.erp_id),
                    brand
                );
            }

            // Si brands todavía no terminó de cargar,
            // hacemos una lectura rápida para resolver nombres.
            if (
                brandMap.size === 0 &&
                articleRows.some(
                    (article) =>
                        article.brand_id !== null
                )
            ) {
                const { data } = await supabase
                    .from("brands")
                    .select(`
                        erp_id,
                        name,
                        prefix
                    `);

                for (const brand of data ?? []) {
                    brandMap.set(
                        Number(brand.erp_id),
                        brand as BrandRow
                    );
                }
            }

            const productMap = new Map<
                number,
                ProductStat
            >();

            for (const row of salesRows) {
                const articleId =
                    Number(row.article_id);

                if (
                    !Number.isFinite(articleId) ||
                    articleId <= 0
                ) {
                    continue;
                }

                const documentType =
                    Number(row.document_type);

                const isCreditNote =
                    CREDIT_NOTE_TYPES.has(
                        documentType
                    );

                const isInvoice =
                    INVOICE_TYPES.has(
                        documentType
                    );

                const sign =
                    isCreditNote ? -1 : 1;

                const quantity =
                    Math.abs(
                        Number(row.quantity ?? 0)
                    ) * sign;

                const absoluteAmount =
                    lineAmount(row);

                const amount =
                    absoluteAmount * sign;

                const grossSales =
                    isInvoice
                        ? absoluteAmount
                        : 0;

                const creditNotes =
                    isCreditNote
                        ? absoluteAmount
                        : 0;

                const article =
                    articleMap.get(articleId);

                const brandId =
                    article?.brand_id !== null &&
                    article?.brand_id !== undefined
                        ? Number(
                              article.brand_id
                          )
                        : null;

                const brand =
                    brandId !== null
                        ? brandMap.get(brandId)
                        : null;

                const current =
                    productMap.get(articleId);

                if (!current) {
                    productMap.set(articleId, {
                        articleId,
                        code:
                            article?.code ||
                            row.article_code ||
                            `ID ${articleId}`,
                        name:
                            article?.name ||
                            row.article_name ||
                            "Sin descripción",
                        brandId,
                        brandName:
                            brand?.name ||
                            "Sin marca/familia",
                        units: quantity,
                        amount,
                        grossSales,
                        creditNotes,
                        operations: 1,
                        lastSale:
                            row.issued_at,
                    });
                    continue;
                }

                current.units += quantity;
                current.amount += amount;
                current.grossSales += grossSales;
                current.creditNotes += creditNotes;
                current.operations += 1;

                if (
                    row.issued_at &&
                    (!current.lastSale ||
                        row.issued_at >
                            current.lastSale)
                ) {
                    current.lastSale =
                        row.issued_at;
                }
            }

            setProducts(
                Array.from(productMap.values())
            );

            // La comparación por zona debe respetar TODOS los filtros,
            // incluida Marca/Familia. El fetch ya respeta fecha, zona,
            // cliente y producto; acá aplicamos también la familia.
            const rowsForZoneStats =
                brandValue === "all"
                    ? salesRows
                    : salesRows.filter((row) => {
                          const rowArticleId =
                              Number(row.article_id);

                          const rowArticle =
                              articleMap.get(
                                  rowArticleId
                              );

                          return (
                              rowArticle?.brand_id !==
                                  null &&
                              rowArticle?.brand_id !==
                                  undefined &&
                              String(
                                  rowArticle.brand_id
                              ) === brandValue
                          );
                      });

            setAnalyzedRows(
                rowsForZoneStats
            );

            // Recién acá los filtros pasan a ser "aplicados".
            // De esta forma escribir/selectear no recalcula la pantalla.
            setAppliedFromDate(from);
            setAppliedToDate(to);
            setAppliedCustomerId(customerId);
            setAppliedCustomerSearch(customerText);
            setAppliedBrandFilter(brandValue);
            setAppliedZoneFilter(zoneValue);
            setAppliedArticleSearch(articleValue);
            setAppliedArticleId(articleId);
            setDetailPage(1);
        } catch (caughtError) {
            console.error(
                "Error calculando estadísticas:",
                caughtError
            );

            setProducts([]);
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "No se pudieron calcular las estadísticas."
            );
        } finally {
            setLoading(false);
        }
    }

    function exportOrderExcel() {
        const orderRows = filteredProducts
            .filter(
                (product) =>
                    product.units > 0
            )
            .map((product) => ({
                Codigo: product.code,
                Cantidad: Number(
                    product.units.toFixed(3)
                ),
            }));

        if (orderRows.length === 0) {
            setError(
                "No hay productos con cantidad positiva para exportar."
            );
            return;
        }

        const worksheet =
            XLSX.utils.json_to_sheet(orderRows);

        worksheet["!cols"] = [
            { wch: 22 },
            { wch: 12 },
        ];

        const workbook =
            XLSX.utils.book_new();

        XLSX.utils.book_append_sheet(
            workbook,
            worksheet,
            "Pedido"
        );

        const customerPart =
            appliedCustomerId !== null
                ? `_Cliente_${appliedCustomerId}`
                : "";

        const brandPart =
            appliedBrandFilter !== "all"
                ? `_Familia_${appliedBrandFilter}`
                : "";

        const zonePart =
            appliedZoneFilter !== "all"
                ? `_Zona_${appliedZoneFilter}`
                : "";

        const fileName =
            `Pedido_${appliedFromDate}_${appliedToDate}${customerPart}${brandPart}${zonePart}.xlsx`;

        XLSX.writeFile(
            workbook,
            sanitizeFilePart(fileName.replace(".xlsx", "")) +
                ".xlsx"
        );
    }

    function applyPreset(
        value: PeriodPreset
    ) {
        setPeriod(value);

        if (value === "range") {
            return;
        }

        const range =
            getPresetRange(value);

        setFromDate(range.from);
        setToDate(range.to);

        // No recalculamos automáticamente.
        // El usuario confirma todos los filtros con "Analizar".
    }

    function clearFilters() {
        const defaultRange =
            getPresetRange("30d");

        setPeriod("30d");
        setFromDate(defaultRange.from);
        setToDate(defaultRange.to);
        setBrandFilter("all");
        setZoneFilter("all");
        setArticleSearch("");
        setSelectedArticleId(null);
        setArticleSuggestions([]);
        setShowArticleSuggestions(false);

        setCustomerSearch("");
        setSelectedCustomerId(null);
        setCustomerSuggestions([]);
        setShowCustomerSuggestions(false);

        setError(null);
    }

    function handleSubmit(
        event: FormEvent
    ) {
        event.preventDefault();

        runStatistics(
            fromDate,
            toDate,
            selectedCustomerId,
            customerSearch,
            brandFilter,
            articleSearch,
            zoneFilter,
            selectedArticleId
        );
    }

    const filteredProducts =
        useMemo(() => {
            const search =
                appliedArticleSearch
                    .trim()
                    .toLocaleLowerCase("es");

            return products
                .filter((product) => {
                    if (
                        appliedBrandFilter !== "all" &&
                        String(
                            product.brandId
                        ) !== appliedBrandFilter
                    ) {
                        return false;
                    }

                    // Si el producto fue elegido desde el predictivo,
                    // ya viene filtrado por article_id desde Supabase.
                    // No volvemos a filtrar por el texto completo
                    // "CODIGO - DESCRIPCION", porque eso dejaba 0 resultados.
                    if (
                        appliedArticleId !== null
                    ) {
                        return (
                            product.articleId ===
                            appliedArticleId
                        );
                    }

                    if (!search) {
                        return true;
                    }

                    return (
                        product.code
                            .toLocaleLowerCase("es")
                            .includes(search) ||
                        product.name
                            .toLocaleLowerCase("es")
                            .includes(search)
                    );
                })
                .sort(
                    (a, b) =>
                        b.units - a.units ||
                        b.amount - a.amount
                );
        }, [
            products,
            appliedBrandFilter,
            appliedArticleSearch,
            appliedArticleId,
        ]);

    const detailTotalPages = Math.max(
        1,
        Math.ceil(
            filteredProducts.length /
                DETAIL_PAGE_SIZE
        )
    );

    const safeDetailPage = Math.min(
        detailPage,
        detailTotalPages
    );

    const detailStart =
        (safeDetailPage - 1) *
        DETAIL_PAGE_SIZE;

    const paginatedProducts =
        filteredProducts.slice(
            detailStart,
            detailStart + DETAIL_PAGE_SIZE
        );

    useEffect(() => {
        if (detailPage > detailTotalPages) {
            setDetailPage(
                detailTotalPages
            );
        }
    }, [
        detailPage,
        detailTotalPages,
    ]);

    const totals = useMemo(() => {
        return filteredProducts.reduce(
            (accumulator, product) => {
                accumulator.units +=
                    product.units;
                accumulator.amount +=
                    product.amount;
                accumulator.grossSales +=
                    product.grossSales;
                accumulator.creditNotes +=
                    product.creditNotes;
                accumulator.operations +=
                    product.operations;

                return accumulator;
            },
            {
                units: 0,
                amount: 0,
                grossSales: 0,
                creditNotes: 0,
                operations: 0,
            }
        );
    }, [filteredProducts]);

    const brandStats =
        useMemo<BrandStat[]>(() => {
            const map = new Map<
                string,
                BrandStat & {
                    productIds: Set<number>;
                }
            >();

            for (const product of products) {
                const key =
                    product.brandId !== null
                        ? String(
                              product.brandId
                          )
                        : "none";

                const current = map.get(key);

                if (!current) {
                    map.set(key, {
                        brandId:
                            product.brandId,
                        name:
                            product.brandName,
                        units:
                            product.units,
                        amount:
                            product.amount,
                        products:
                            1,
                        productIds:
                            new Set([
                                product.articleId,
                            ]),
                    });
                    continue;
                }

                current.units +=
                    product.units;
                current.amount +=
                    product.amount;
                current.productIds.add(
                    product.articleId
                );
                current.products =
                    current.productIds.size;
            }

            return Array.from(map.values())
                .map(
                    ({
                        productIds: _productIds,
                        ...brand
                    }) => brand
                )
                .sort(
                    (a, b) =>
                        b.units - a.units ||
                        b.amount - a.amount
                );
        }, [products]);

    const visibleBrandStats = useMemo(
        () =>
            brandStats.filter((brand) => {
                if (
                    appliedBrandFilter === "all"
                ) {
                    return true;
                }

                return (
                    String(brand.brandId) ===
                    appliedBrandFilter
                );
            }),
        [brandStats, appliedBrandFilter]
    );

    const [
        zoneStatsResolved,
        setZoneStatsResolved,
    ] = useState<ZoneStat[]>([]);

    useEffect(() => {
        let cancelled = false;

        async function resolveZoneStats() {
            if (analyzedRows.length === 0) {
                setZoneStatsResolved([]);
                return;
            }

            const customerIds = Array.from(
                new Set(
                    analyzedRows
                        .map((row) =>
                            Number(row.customer_id)
                        )
                        .filter(
                            (id) =>
                                Number.isFinite(id) &&
                                id > 0
                        )
                )
            );

            const customerZoneMap =
                new Map<number, string>();

            for (
                let index = 0;
                index < customerIds.length;
                index += 400
            ) {
                const chunk =
                    customerIds.slice(
                        index,
                        index + 400
                    );

                const { data, error } =
                    await supabase
                        .from("customers")
                        .select(`
                            erp_id,
                            zone
                        `)
                        .in("erp_id", chunk);

                if (error) {
                    console.error(
                        "Error resolviendo zonas:",
                        error
                    );
                    continue;
                }

                for (const row of data ?? []) {
                    const customerId =
                        Number(row.erp_id);
                    const zone =
                        String(
                            row.zone ??
                                "Sin zona"
                        ).trim() ||
                        "Sin zona";

                    customerZoneMap.set(
                        customerId,
                        zone
                    );
                }
            }

            const map = new Map<
                string,
                {
                    units: number;
                    amount: number;
                    productIds: Set<number>;
                    customerIds: Set<number>;
                }
            >();

            for (const row of analyzedRows) {
                const customerId =
                    Number(row.customer_id);
                const articleId =
                    Number(row.article_id);
                const zone =
                    customerZoneMap.get(
                        customerId
                    ) || "Sin zona";

                const sign =
                    CREDIT_NOTE_TYPES.has(
                        Number(row.document_type)
                    )
                        ? -1
                        : 1;

                const units =
                    Math.abs(
                        Number(
                            row.quantity ?? 0
                        )
                    ) * sign;

                const amount =
                    lineAmount(row) * sign;

                const current =
                    map.get(zone);

                if (!current) {
                    map.set(zone, {
                        units,
                        amount,
                        productIds:
                            new Set(
                                Number.isFinite(
                                    articleId
                                )
                                    ? [articleId]
                                    : []
                            ),
                        customerIds:
                            new Set(
                                Number.isFinite(
                                    customerId
                                )
                                    ? [customerId]
                                    : []
                            ),
                    });
                    continue;
                }

                current.units += units;
                current.amount += amount;

                if (
                    Number.isFinite(articleId)
                ) {
                    current.productIds.add(
                        articleId
                    );
                }

                if (
                    Number.isFinite(customerId)
                ) {
                    current.customerIds.add(
                        customerId
                    );
                }
            }

            const resolved =
                Array.from(map.entries())
                    .map(
                        ([zone, value]) => ({
                            zone,
                            units:
                                value.units,
                            amount:
                                value.amount,
                            products:
                                value.productIds
                                    .size,
                            customers:
                                value.customerIds
                                    .size,
                        })
                    )
                    .sort(
                        (a, b) =>
                            b.units -
                                a.units ||
                            compareZones(
                                a.zone,
                                b.zone
                            )
                    );

            if (!cancelled) {
                setZoneStatsResolved(
                    resolved
                );
            }
        }

        resolveZoneStats();

        return () => {
            cancelled = true;
        };
    }, [analyzedRows]);

    const maxZoneUnits = Math.max(
        1,
        ...zoneStatsResolved
            .slice(0, 10)
            .map((zone) =>
                Math.max(0, zone.units)
            )
    );

    const maxProductUnits = Math.max(
        1,
        ...filteredProducts
            .slice(0, 15)
            .map((product) =>
                Math.max(0, product.units)
            )
    );

    const maxBrandUnits = Math.max(
        1,
        ...visibleBrandStats
            .slice(0, 15)
            .map((brand) =>
                Math.max(0, brand.units)
            )
    );

    const hasPendingFilters =
        fromDate !== appliedFromDate ||
        toDate !== appliedToDate ||
        brandFilter !== appliedBrandFilter ||
        zoneFilter !== appliedZoneFilter ||
        selectedArticleId !==
            appliedArticleId ||
        articleSearch.trim() !==
            appliedArticleSearch.trim() ||
        selectedCustomerId !==
            appliedCustomerId ||
        customerSearch.trim() !==
            appliedCustomerSearch.trim();

    return (
        <main className="min-h-screen bg-slate-50 text-gray-900">
            <LoadingOverlay
                visible={loading}
                text="Calculando estadísticas..."
            />

            <AppNavbar
                active="estadisticas"
                title="Estadísticas de ventas"
                subtitle="Analizá qué se vende para planificar mejor los pedidos."
                loggedUsername={loggedUsername}
                lastSync={
                    lastSync
                        ? formatDateTime(lastSync)
                        : null
                }
            />

            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
                <section className="relative z-30 mb-6 overflow-visible rounded-2xl border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-100 px-5 py-4">
                        <div className="flex items-center gap-3">
                            <div className="h-6 w-1 rounded-full bg-red-700" />

                            <div>
                                <h2 className="font-semibold text-gray-900">
                                    Período y filtros
                                </h2>

                                <p className="text-sm text-gray-500">
                                    Configurá período, zona, familia, producto o cliente y presioná Analizar. Las estadísticas solo se recalculan al tocar Analizar.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="p-5">
                        <div className="flex flex-wrap gap-2">
                            {[
                                ["7d", "Últimos 7 días"],
                                ["30d", "Últimos 30 días"],
                                ["month", "Este mes"],
                                [
                                    "previousMonth",
                                    "Mes anterior",
                                ],
                            ].map(
                                ([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() =>
                                            applyPreset(
                                                value as PeriodPreset
                                            )
                                        }
                                        className={`rounded-xl border px-4 py-2.5 text-sm font-bold transition ${
                                            period ===
                                            value
                                                ? "border-red-700 bg-red-700 text-white"
                                                : "border-gray-200 bg-white text-gray-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                                        }`}
                                    >
                                        {label}
                                    </button>
                                )
                            )}
                        </div>

                        <form
                            onSubmit={handleSubmit}
                            className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
                        >
                            <div>
                                <label className="mb-2 block text-sm font-medium text-gray-700">
                                    Desde
                                </label>

                                <input
                                    type="date"
                                    value={fromDate}
                                    onChange={(event) => {
                                        setPeriod("range");
                                        setFromDate(
                                            event.target
                                                .value
                                        );
                                    }}
                                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
                                />
                            </div>

                            <div>
                                <label className="mb-2 block text-sm font-medium text-gray-700">
                                    Hasta
                                </label>

                                <input
                                    type="date"
                                    value={toDate}
                                    onChange={(event) => {
                                        setPeriod("range");
                                        setToDate(
                                            event.target
                                                .value
                                        );
                                    }}
                                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
                                />
                            </div>

                            <div>
                                <label className="mb-2 block text-sm font-medium text-gray-700">
                                    Zona
                                </label>

                                <select
                                    value={zoneFilter}
                                    onChange={(event) => {
                                        setZoneFilter(
                                            event.target.value
                                        );

                                        // Si cambia la zona, limpiamos el cliente.
                                        // La nueva búsqueda se aplicará recién al
                                        // presionar "Analizar".
                                        setCustomerSearch("");
                                        setSelectedCustomerId(
                                            null
                                        );
                                        setCustomerSuggestions(
                                            []
                                        );
                                        setShowCustomerSuggestions(
                                            false
                                        );
                                    }}
                                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
                                >
                                    <option value="all">
                                        Todas las zonas
                                    </option>

                                    {zones.map((zone) => (
                                        <option
                                            key={zone}
                                            value={zone}
                                        >
                                            Zona {zone}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="mb-2 block text-sm font-medium text-gray-700">
                                    Marca / familia
                                </label>

                                <select
                                    value={brandFilter}
                                    onChange={(event) =>
                                        setBrandFilter(
                                            event.target
                                                .value
                                        )
                                    }
                                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
                                >
                                    <option value="all">
                                        Todas las familias
                                    </option>

                                    {brands.map(
                                        (brand) => (
                                            <option
                                                key={
                                                    brand.erp_id
                                                }
                                                value={String(
                                                    brand.erp_id
                                                )}
                                            >
                                                {brand.prefix
                                                    ? `${brand.prefix} - `
                                                    : ""}
                                                {brand.name ||
                                                    `Marca ${brand.erp_id}`}
                                            </option>
                                        )
                                    )}
                                </select>
                            </div>

                            <div className="relative z-40">
                                <label className="mb-2 block text-sm font-medium text-gray-700">
                                    Producto
                                </label>

                                <input
                                    type="text"
                                    autoComplete="off"
                                    value={articleSearch}
                                    onFocus={() =>
                                        setShowArticleSuggestions(
                                            true
                                        )
                                    }
                                    onBlur={() =>
                                        setTimeout(
                                            () =>
                                                setShowArticleSuggestions(
                                                    false
                                                ),
                                            150
                                        )
                                    }
                                    onChange={(event) => {
                                        setArticleSearch(
                                            event.target.value
                                        );
                                        setSelectedArticleId(
                                            null
                                        );
                                        setShowArticleSuggestions(
                                            true
                                        );
                                    }}
                                    placeholder="Ej: 35-6150, 50-BA358, bomba de agua..."
                                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-red-600 focus:ring-2 focus:ring-red-100"
                                />

                                {showArticleSuggestions &&
                                    articleSearch.trim().length >=
                                        2 &&
                                    (articleSuggestions.length >
                                        0 ||
                                        articleSuggestionsLoading) && (
                                        <div className="absolute left-0 z-[100] mt-2 max-h-80 w-[min(560px,calc(100vw-3rem))] overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl">
                                            {articleSuggestionsLoading &&
                                                articleSuggestions.length ===
                                                    0 && (
                                                    <p className="px-4 py-3 text-sm text-gray-500">
                                                        Buscando artículos...
                                                    </p>
                                                )}

                                            {articleSuggestions.map(
                                                (article) => (
                                                    <button
                                                        key={
                                                            article.erp_id
                                                        }
                                                        type="button"
                                                        onMouseDown={(
                                                            event
                                                        ) =>
                                                            event.preventDefault()
                                                        }
                                                        onClick={() => {
                                                            setSelectedArticleId(
                                                                article.erp_id
                                                            );
                                                            setArticleSearch(
                                                                `${
                                                                    article.code ||
                                                                    article.erp_id
                                                                } - ${
                                                                    article.name ||
                                                                    "Sin descripción"
                                                                }`
                                                            );
                                                            setShowArticleSuggestions(
                                                                false
                                                            );
                                                        }}
                                                        className="block w-full border-b border-gray-100 px-4 py-3.5 text-left transition last:border-b-0 hover:bg-red-50 focus:bg-red-50 focus:outline-none"
                                                    >
                                                        <p className="text-sm font-bold text-gray-900">
                                                            {article.code ||
                                                                `ID ${article.erp_id}`}
                                                        </p>

                                                        <p className="mt-1 line-clamp-2 pr-2 text-xs leading-5 text-gray-500">
                                                            {article.name ||
                                                                "Sin descripción"}
                                                        </p>
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    )}
                            </div>

                            <div className="relative z-40">
                                <label className="mb-2 block text-sm font-medium text-gray-700">
                                    Cliente
                                </label>

                                <input
                                    type="text"
                                    autoComplete="off"
                                    value={customerSearch}
                                    onFocus={() =>
                                        setShowCustomerSuggestions(
                                            true
                                        )
                                    }
                                    onBlur={() =>
                                        setTimeout(
                                            () =>
                                                setShowCustomerSuggestions(
                                                    false
                                                ),
                                            150
                                        )
                                    }
                                    onChange={(event) => {
                                        setCustomerSearch(
                                            event.target.value
                                        );
                                        setSelectedCustomerId(
                                            null
                                        );
                                        setShowCustomerSuggestions(
                                            true
                                        );
                                    }}
                                    placeholder={
                                        zoneFilter !== "all"
                                            ? `Cliente de Zona ${zoneFilter}...`
                                            : "Ej: REPETTI, 343, IMPULSO..."
                                    }
                                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-red-600 focus:ring-2 focus:ring-red-100"
                                />

                                {showCustomerSuggestions &&
                                    customerSearch.trim().length >=
                                        2 &&
                                    (customerSuggestions.length >
                                        0 ||
                                        customerSuggestionsLoading) && (
                                        <div className="absolute left-0 z-[100] mt-2 max-h-80 w-[min(520px,calc(100vw-3rem))] overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl">
                                            {customerSuggestionsLoading &&
                                                customerSuggestions.length ===
                                                    0 && (
                                                    <p className="px-4 py-3 text-sm text-gray-500">
                                                        Buscando clientes...
                                                    </p>
                                                )}

                                            {customerSuggestions.map(
                                                (customer) => (
                                                    <button
                                                        key={
                                                            customer.erp_id
                                                        }
                                                        type="button"
                                                        onMouseDown={(
                                                            event
                                                        ) =>
                                                            event.preventDefault()
                                                        }
                                                        onClick={() => {
                                                            setSelectedCustomerId(
                                                                customer.erp_id
                                                            );
                                                            setCustomerSearch(
                                                                `${customer.erp_id} - ${
                                                                    customer.name ||
                                                                    "Sin nombre"
                                                                }`
                                                            );
                                                            setShowCustomerSuggestions(
                                                                false
                                                            );
                                                        }}
                                                        className="block w-full border-b border-gray-100 px-4 py-3.5 text-left transition last:border-b-0 hover:bg-red-50 focus:bg-red-50 focus:outline-none"
                                                    >
                                                        <p className="text-sm font-bold text-gray-900">
                                                            {customer.name ||
                                                                "Sin nombre"}
                                                        </p>

                                                        <p className="mt-1 text-xs text-gray-500">
                                                            Código{" "}
                                                            {
                                                                customer.erp_id
                                                            }
                                                            {customer.zone
                                                                ? ` · Zona ${customer.zone}`
                                                                : ""}
                                                        </p>
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    )}

                                {zoneFilter !== "all" && (
                                    <p className="mt-1.5 text-xs font-medium text-gray-500">
                                        Solo se sugieren clientes de Zona {zoneFilter}.
                                    </p>
                                )}
                            </div>

                            <div className="flex items-end gap-2 xl:col-span-2">
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="flex min-w-[130px] flex-1 items-center justify-center rounded-xl bg-red-700 px-6 py-3 font-bold text-white shadow-sm transition hover:bg-red-800 disabled:opacity-60"
                                >
                                    {loading
                                        ? "Analizando..."
                                        : "Analizar"}
                                </button>

                                <button
                                    type="button"
                                    onClick={clearFilters}
                                    disabled={loading}
                                    className="flex items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-3 font-bold text-gray-700 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                                >
                                    Limpiar
                                </button>
                            </div>
                        </form>

                        {hasPendingFilters && !loading && (
                            <div className="relative z-0 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                                Presioná <strong>Analizar</strong> para actualizar los resultados.
                            </div>
                        )}

                    </div>
                </section>

                {error && (
                    <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
                        {error}
                    </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <StatCard
                        label="Unidades vendidas netas"
                        value={formatQuantity(
                            totals.units
                        )}
                        helper="Facturas menos unidades devueltas por NC y NCX"
                    />

                    <StatCard
                        label="Ventas brutas"
                        value={formatMoney(
                            totals.grossSales
                        )}
                        helper="Importe facturado en FC + FCX"
                    />

                    <StatCard
                        label="Notas de crédito"
                        value={formatMoney(
                            totals.creditNotes
                        )}
                        helper="Importe de NC + NCX del período"
                    />

                    <StatCard
                        label="Venta neta"
                        value={formatMoney(
                            totals.amount
                        )}
                        helper="Ventas brutas menos notas de crédito"
                    />

                    <StatCard
                        label="Renglones analizados"
                        value={new Intl.NumberFormat(
                            "es-AR"
                        ).format(
                            totals.operations
                        )}
                        helper="Movimientos incluidos en el análisis"
                    />

                    <StatCard
                        label="Familias activas"
                        value={String(
                            visibleBrandStats.filter(
                                (brand) =>
                                    brand.units !== 0
                            ).length
                        )}
                        helper={`${formatDate(
                            `${appliedFromDate}T12:00:00`
                        )} al ${formatDate(
                            `${appliedToDate}T12:00:00`
                        )}`}
                    />
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-2">
                    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="mb-5">
                            <h2 className="text-lg font-bold text-gray-900">
                                Productos con mayor salida
                            </h2>

                            <p className="mt-1 text-sm text-gray-500">
                                Ranking por unidades netas: FC + FCX menos NC + NCX.
                            </p>
                        </div>

                        <div className="space-y-4">
                            {filteredProducts
                                .slice(0, 15)
                                .map(
                                    (
                                        product,
                                        index
                                    ) => (
                                        <div
                                            key={
                                                product.articleId
                                            }
                                        >
                                            <div className="mb-1.5 flex items-start justify-between gap-4">
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-bold text-gray-900">
                                                        {index +
                                                            1}
                                                        .{" "}
                                                        {
                                                            product.code
                                                        }
                                                    </p>

                                                    <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">
                                                        {
                                                            product.name
                                                        }
                                                    </p>
                                                </div>

                                                <span className="whitespace-nowrap text-sm font-extrabold text-gray-900">
                                                    {formatQuantity(
                                                        product.units
                                                    )}{" "}
                                                    u.
                                                </span>
                                            </div>

                                            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                                                <div
                                                    className="h-full rounded-full bg-red-700"
                                                    style={{
                                                        width: `${Math.max(
                                                            2,
                                                            (Math.max(
                                                                0,
                                                                product.units
                                                            ) /
                                                                maxProductUnits) *
                                                                100
                                                        )}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )
                                )}

                            {!loading &&
                                filteredProducts.length ===
                                    0 && (
                                    <p className="py-8 text-center text-sm text-gray-500">
                                        No hay ventas para los filtros seleccionados.
                                    </p>
                                )}
                        </div>
                    </section>

                    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="mb-5">
                            <h2 className="text-lg font-bold text-gray-900">
                                Salida por marca / familia
                            </h2>

                            <p className="mt-1 text-sm text-gray-500">
                                Te sirve para decidir qué proveedor o familia necesita reposición.
                            </p>
                        </div>

                        <div className="space-y-4">
                            {visibleBrandStats
                                .slice(0, 15)
                                .map(
                                    (
                                        brand,
                                        index
                                    ) => (
                                        <div
                                            key={`${brand.brandId}-${brand.name}`}
                                        >
                                            <div className="mb-1.5 flex items-center justify-between gap-4">
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-bold text-gray-900">
                                                        {index +
                                                            1}
                                                        .{" "}
                                                        {
                                                            brand.name
                                                        }
                                                    </p>

                                                    <p className="mt-0.5 text-xs text-gray-500">
                                                        {
                                                            brand.products
                                                        }{" "}
                                                        productos ·{" "}
                                                        {formatMoney(
                                                            brand.amount
                                                        )}
                                                    </p>
                                                </div>

                                                <span className="whitespace-nowrap text-sm font-extrabold text-gray-900">
                                                    {formatQuantity(
                                                        brand.units
                                                    )}{" "}
                                                    u.
                                                </span>
                                            </div>

                                            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                                                <div
                                                    className="h-full rounded-full bg-red-700"
                                                    style={{
                                                        width: `${Math.max(
                                                            2,
                                                            (Math.max(
                                                                0,
                                                                brand.units
                                                            ) /
                                                                maxBrandUnits) *
                                                                100
                                                        )}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )
                                )}
                        </div>
                    </section>
                </div>

                <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">
                                Comparación por zona
                            </h2>

                            <p className="mt-1 text-sm text-gray-500">
                                Compará qué zonas tienen mayor salida y cuánto venden en el período analizado.
                            </p>
                        </div>

                        {appliedZoneFilter !==
                            "all" && (
                            <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700">
                                Zona{" "}
                                {
                                    appliedZoneFilter
                                }
                            </span>
                        )}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                        {zoneStatsResolved
                            .slice(0, 10)
                            .map(
                                (
                                    zone,
                                    index
                                ) => (
                                    <div
                                        key={
                                            zone.zone
                                        }
                                        className="rounded-xl border border-gray-100 bg-gray-50 p-4"
                                    >
                                        <div className="mb-2 flex items-start justify-between gap-4">
                                            <div>
                                                <p className="font-bold text-gray-900">
                                                    {index +
                                                        1}
                                                    . Zona{" "}
                                                    {
                                                        zone.zone
                                                    }
                                                </p>

                                                <p className="mt-1 text-xs text-gray-500">
                                                    {
                                                        zone.customers
                                                    }{" "}
                                                    clientes ·{" "}
                                                    {
                                                        zone.products
                                                    }{" "}
                                                    productos ·{" "}
                                                    {formatMoney(
                                                        zone.amount
                                                    )}
                                                </p>
                                            </div>

                                            <span className="whitespace-nowrap text-sm font-extrabold text-gray-900">
                                                {formatQuantity(
                                                    zone.units
                                                )}{" "}
                                                u.
                                            </span>
                                        </div>

                                        <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                                            <div
                                                className="h-full rounded-full bg-red-700"
                                                style={{
                                                    width: `${Math.max(
                                                        2,
                                                        (Math.max(
                                                            0,
                                                            zone.units
                                                        ) /
                                                            maxZoneUnits) *
                                                            100
                                                    )}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                )
                            )}

                        {!loading &&
                            zoneStatsResolved.length ===
                                0 && (
                                <p className="py-8 text-sm text-gray-500">
                                    No hay información por zona para los filtros aplicados.
                                </p>
                            )}
                    </div>
                </section>

                <section className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">
                                Detalle para preparar pedidos
                            </h2>

                            <p className="mt-1 text-sm text-gray-500">
                                Ordenado por salida neta. Las NC y NCX descuentan unidades e importe de las FC y FCX.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700">
                                {filteredProducts.length} productos
                            </span>

                            {filteredProducts.length >
                                DETAIL_PAGE_SIZE && (
                                <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-600">
                                    Página {safeDetailPage} de{" "}
                                    {detailTotalPages}
                                </span>
                            )}

                            <button
                                type="button"
                                onClick={exportOrderExcel}
                                disabled={
                                    loading ||
                                    filteredProducts.every(
                                        (product) =>
                                            product.units <= 0
                                    )
                                }
                                className="inline-flex items-center justify-center rounded-xl bg-green-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Exportar pedido Excel
                            </button>
                        </div>
                    </div>

                    <div className="hidden overflow-x-auto lg:block">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Producto
                                    </th>

                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Marca / familia
                                    </th>

                                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Unidades
                                    </th>

                                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Importe
                                    </th>

                                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Mov.
                                    </th>

                                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Última venta
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                {paginatedProducts.map(
                                    (product) => (
                                        <tr
                                            key={
                                                product.articleId
                                            }
                                            className="border-t border-gray-100 transition hover:bg-red-50/30"
                                        >
                                            <td className="px-4 py-4">
                                                <p className="text-sm font-bold text-gray-900">
                                                    {
                                                        product.code
                                                    }
                                                </p>

                                                <p className="mt-1 max-w-xl text-sm text-gray-500">
                                                    {
                                                        product.name
                                                    }
                                                </p>
                                            </td>

                                            <td className="px-4 py-4 text-sm font-medium text-gray-700">
                                                {
                                                    product.brandName
                                                }
                                            </td>

                                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-extrabold tabular-nums text-gray-900">
                                                {formatQuantity(
                                                    product.units
                                                )}
                                            </td>

                                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-semibold tabular-nums text-gray-900">
                                                {formatMoney(
                                                    product.amount
                                                )}
                                            </td>

                                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-medium tabular-nums text-gray-700">
                                                {
                                                    product.operations
                                                }
                                            </td>

                                            <td className="whitespace-nowrap px-4 py-4 text-right text-sm text-gray-600">
                                                {formatDate(
                                                    product.lastSale
                                                )}
                                            </td>
                                        </tr>
                                    )
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="grid gap-3 p-4 lg:hidden">
                        {paginatedProducts.map(
                            (product) => (
                                <article
                                    key={
                                        product.articleId
                                    }
                                    className="rounded-xl border border-gray-200 p-4"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="font-bold text-gray-900">
                                                {
                                                    product.code
                                                }
                                            </p>

                                            <p className="mt-1 text-sm text-gray-500">
                                                {
                                                    product.name
                                                }
                                            </p>
                                        </div>

                                        <span className="rounded-lg bg-red-50 px-2.5 py-1.5 text-sm font-extrabold text-red-700">
                                            {formatQuantity(
                                                product.units
                                            )}{" "}
                                            u.
                                        </span>
                                    </div>

                                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <p className="text-xs text-gray-400">
                                                Familia
                                            </p>
                                            <p className="mt-1 font-semibold text-gray-700">
                                                {
                                                    product.brandName
                                                }
                                            </p>
                                        </div>

                                        <div>
                                            <p className="text-xs text-gray-400">
                                                Importe
                                            </p>
                                            <p className="mt-1 font-semibold text-gray-700">
                                                {formatMoney(
                                                    product.amount
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                </article>
                            )
                        )}
                    </div>

                    {filteredProducts.length >
                        DETAIL_PAGE_SIZE && (
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-4 py-4">
                            <p className="text-sm text-gray-500">
                                Mostrando{" "}
                                <strong className="text-gray-700">
                                    {detailStart + 1}
                                </strong>{" "}
                                a{" "}
                                <strong className="text-gray-700">
                                    {Math.min(
                                        detailStart +
                                            DETAIL_PAGE_SIZE,
                                        filteredProducts.length
                                    )}
                                </strong>{" "}
                                de{" "}
                                <strong className="text-gray-700">
                                    {filteredProducts.length}
                                </strong>{" "}
                                productos
                            </p>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setDetailPage(
                                            (page) =>
                                                Math.max(
                                                    1,
                                                    page - 1
                                                )
                                        )
                                    }
                                    disabled={
                                        safeDetailPage <= 1
                                    }
                                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Anterior
                                </button>

                                <span className="min-w-[95px] text-center text-sm font-bold text-gray-700">
                                    {safeDetailPage} /{" "}
                                    {detailTotalPages}
                                </span>

                                <button
                                    type="button"
                                    onClick={() =>
                                        setDetailPage(
                                            (page) =>
                                                Math.min(
                                                    detailTotalPages,
                                                    page + 1
                                                )
                                        )
                                    }
                                    disabled={
                                        safeDetailPage >=
                                        detailTotalPages
                                    }
                                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Siguiente
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}
