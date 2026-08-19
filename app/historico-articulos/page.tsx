"use client";

import {
    FormEvent,
    Suspense,
    useEffect,
    useMemo,
    useState,
} from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LoadingOverlay from "@/components/LoadingOverlay";
import NavigationLoadingLink from "@/components/NavigationLoadingLink";

type ArticleHistoryRow = {
    erp_row_id: number;
    invoice_id: number;
    customer_id: number | null;
    customer_name: string | null;
    article_id: number | null;
    article_code: string | null;
    article_name: string | null;
    document_type: number | null;
    form: string | null;
    document_number: number | string | null;
    issued_at: string | null;
    quantity: number | string | null;
    unit_price: number | string | null;
    discount_percentage: number | string | null;
    user_id: number | null;
    user_name: string | null;
};

type DocumentType = {
    erp_id: number;
    name: string | null;
    abbreviation: string | null;
};

type ArticleSuggestion = {
    article_id: number;
    article_code: string | null;
    article_name: string | null;
};

type CustomerSuggestion = {
    customer_id: number;
    customer_name: string | null;
};

const PAGE_SIZE = 100;

type SearchState = {
    articleSearch: string;
    customerSearch: string;
    selectedArticleId: number | null;
    selectedCustomerId: number | null;
    fromDate: string;
    toDate: string;
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

function formatTime(
    value: string | null | undefined
) {
    if (!value) return "-";

    return new Intl.DateTimeFormat("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(new Date(value));
}

function formatMoney(
    value: number | string | null | undefined
) {
    return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        minimumFractionDigits: 2,
    }).format(Number(value ?? 0));
}

function formatQuantity(
    value: number | string | null | undefined
) {
    const numericValue = Number(value ?? 0);

    return new Intl.NumberFormat("es-AR", {
        minimumFractionDigits: Number.isInteger(
            numericValue
        )
            ? 0
            : 2,
        maximumFractionDigits: 3,
    }).format(numericValue);
}

function fallbackDocumentInfo(
    documentType: number | null | undefined
) {
    switch (Number(documentType)) {
        case 1:
            return {
                name: "Factura",
                abbreviation: "FC",
            };

        case 2:
            return {
                name: "Nota de crédito",
                abbreviation: "NC",
            };

        case 6:
            return {
                name: "Nota de débito",
                abbreviation: "ND",
            };

        case 66:
            return {
                name: "Factura 2",
                abbreviation: "FCX",
            };

        case 68:
            return {
                name: "Nota de crédito 2",
                abbreviation: "NCX",
            };

        case 69:
            return {
                name: "Nota de débito 2",
                abbreviation: "NDX",
            };

        default:
            return {
                name: "Comprobante",
                abbreviation: "DOC",
            };
    }
}

function sanitizePostgrestValue(value: string) {
    return value
        .replaceAll(",", " ")
        .replaceAll("(", " ")
        .replaceAll(")", " ")
        .trim();
}

function toArgentinaDayStartUtc(date: string) {
    return new Date(
        `${date}T00:00:00-03:00`
    ).toISOString();
}

function toArgentinaNextDayUtc(date: string) {
    const localMidnight = new Date(
        `${date}T00:00:00-03:00`
    );

    localMidnight.setUTCDate(
        localMidnight.getUTCDate() + 1
    );

    return localMidnight.toISOString();
}

function ArticleHistoryContent() {
    const searchParams = useSearchParams();

    const [rows, setRows] =
        useState<ArticleHistoryRow[]>([]);
    const [documentTypes, setDocumentTypes] =
        useState<DocumentType[]>([]);

    const [articleSearch, setArticleSearch] =
        useState("");
    const [customerSearch, setCustomerSearch] =
        useState("");

    const [
        selectedArticleId,
        setSelectedArticleId,
    ] = useState<number | null>(null);

    const [
        selectedCustomerId,
        setSelectedCustomerId,
    ] = useState<number | null>(null);

    const [fromDate, setFromDate] =
        useState("");
    const [toDate, setToDate] =
        useState("");

    const [loading, setLoading] =
        useState(false);
    const [
        suggestionsLoading,
        setSuggestionsLoading,
    ] = useState(false);

    const [error, setError] =
        useState<string | null>(null);
    const [lastSync, setLastSync] =
        useState<string | null>(null);

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

    const [page, setPage] =
        useState(0);
    const [totalRows, setTotalRows] =
        useState(0);
    const [searched, setSearched] =
        useState(false);

    useEffect(() => {
        loadLastSync();
        loadDocumentTypes();

        const articleIdParam =
            searchParams.get("articleId");

        const articleTextParam =
            searchParams.get("article");

        const customerIdParam =
            searchParams.get("customerId");

        const customerTextParam =
            searchParams.get("customer");

        const fromDateParam =
            searchParams.get("fromDate") ?? "";

        const toDateParam =
            searchParams.get("toDate") ?? "";

        const pageParam =
            Number(searchParams.get("page") ?? "0");

        const restoredArticleId =
            articleIdParam !== null &&
                !Number.isNaN(Number(articleIdParam))
                ? Number(articleIdParam)
                : null;

        const restoredCustomerId =
            customerIdParam !== null &&
                !Number.isNaN(Number(customerIdParam))
                ? Number(customerIdParam)
                : null;

        const restoredPage =
            Number.isFinite(pageParam) &&
                pageParam >= 0
                ? pageParam
                : 0;

        setArticleSearch(
            articleTextParam ?? ""
        );

        setCustomerSearch(
            customerTextParam ?? ""
        );

        setSelectedArticleId(
            restoredArticleId
        );

        setSelectedCustomerId(
            restoredCustomerId
        );

        setFromDate(fromDateParam);
        setToDate(toDateParam);

        runSearch(restoredPage, {
            articleSearch:
                articleTextParam ?? "",
            customerSearch:
                customerTextParam ?? "",
            selectedArticleId:
                restoredArticleId,
            selectedCustomerId:
                restoredCustomerId,
            fromDate: fromDateParam,
            toDate: toDateParam,
        });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadLastSync() {
        const { data, error } = await supabase
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

        if (error) {
            console.error(
                "Error obteniendo última sincronización:",
                error
            );
            setLastSync(null);
            return;
        }

        if (
            data?.success === true &&
            data?.last_completed_at
        ) {
            setLastSync(
                data.last_completed_at
            );
        } else {
            setLastSync(null);
        }
    }

    async function loadDocumentTypes() {
        const { data, error } = await supabase
            .from("document_types")
            .select(`
        erp_id,
        name,
        abbreviation
      `);

        if (error) {
            console.error(
                "Error cargando tipos de comprobante:",
                error
            );
            return;
        }

        setDocumentTypes(
            (data ?? []) as DocumentType[]
        );
    }

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
            loadArticleSuggestions(value);
        }, 250);

        return () => clearTimeout(timeout);
    }, [articleSearch, selectedArticleId]);

    async function loadArticleSuggestions(
        value: string
    ) {
        setSuggestionsLoading(true);

        const safeValue =
            sanitizePostgrestValue(value);
        const numericValue =
            Number(safeValue);

        const filters = [
            `article_code.ilike.%${safeValue}%`,
            `article_name.ilike.%${safeValue}%`,
        ];

        if (!Number.isNaN(numericValue)) {
            filters.push(
                `article_id.eq.${numericValue}`
            );
        }

        const { data, error } = await supabase
            .from("article_history")
            .select(`
        article_id,
        article_code,
        article_name
      `)
            .not("article_id", "is", null)
            .or(filters.join(","))
            .limit(50);

        if (error) {
            console.error(
                "Error buscando artículos:",
                error
            );
            setArticleSuggestions([]);
            setSuggestionsLoading(false);
            return;
        }

        const map =
            new Map<number, ArticleSuggestion>();

        for (const row of data ?? []) {
            const articleId =
                Number(row.article_id);

            if (
                Number.isFinite(articleId) &&
                !map.has(articleId)
            ) {
                map.set(articleId, {
                    article_id: articleId,
                    article_code:
                        row.article_code,
                    article_name:
                        row.article_name,
                });
            }
        }

        setArticleSuggestions(
            Array.from(map.values()).slice(0, 10)
        );
        setSuggestionsLoading(false);
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
            loadCustomerSuggestions(value);
        }, 250);

        return () => clearTimeout(timeout);
    }, [customerSearch, selectedCustomerId]);

    async function loadCustomerSuggestions(
        value: string
    ) {
        setSuggestionsLoading(true);

        const safeValue =
            sanitizePostgrestValue(value);
        const numericValue =
            Number(safeValue);

        const filters = [
            `customer_name.ilike.%${safeValue}%`,
        ];

        if (!Number.isNaN(numericValue)) {
            filters.push(
                `customer_id.eq.${numericValue}`
            );
        }

        const { data, error } = await supabase
            .from("article_history")
            .select(`
        customer_id,
        customer_name
      `)
            .not("customer_id", "is", null)
            .or(filters.join(","))
            .limit(50);

        if (error) {
            console.error(
                "Error buscando clientes:",
                error
            );
            setCustomerSuggestions([]);
            setSuggestionsLoading(false);
            return;
        }

        const map =
            new Map<number, CustomerSuggestion>();

        for (const row of data ?? []) {
            const customerId =
                Number(row.customer_id);

            if (
                Number.isFinite(customerId) &&
                !map.has(customerId)
            ) {
                map.set(customerId, {
                    customer_id: customerId,
                    customer_name:
                        row.customer_name,
                });
            }
        }

        setCustomerSuggestions(
            Array.from(map.values()).slice(0, 10)
        );
        setSuggestionsLoading(false);
    }

    async function runSearch(
        targetPage = 0,
        overrides?: Partial<SearchState>
    ) {
        setLoading(true);
        setError(null);
        setSearched(true);

        const currentArticleSearch =
            overrides?.articleSearch ??
            articleSearch;

        const currentCustomerSearch =
            overrides?.customerSearch ??
            customerSearch;

        const currentSelectedArticleId =
            overrides?.selectedArticleId ??
            selectedArticleId;

        const currentSelectedCustomerId =
            overrides?.selectedCustomerId ??
            selectedCustomerId;

        const currentFromDate =
            overrides?.fromDate ??
            fromDate;

        const currentToDate =
            overrides?.toDate ??
            toDate;

        let query = supabase
            .from("article_history")
            .select(
                `
          erp_row_id,
          invoice_id,
          customer_id,
          customer_name,
          article_id,
          article_code,
          article_name,
          document_type,
          form,
          document_number,
          issued_at,
          quantity,
          unit_price,
          discount_percentage,
          user_id,
          user_name
        `,
                {
                    count: "exact",
                }
            );

        if (currentSelectedArticleId !== null) {
            query = query.eq(
                "article_id",
                currentSelectedArticleId
            );
        } else {
            const value =
                currentArticleSearch.trim();

            if (value) {
                const safeValue =
                    sanitizePostgrestValue(value);
                const numericValue =
                    Number(safeValue);

                const filters = [
                    `article_code.ilike.%${safeValue}%`,
                    `article_name.ilike.%${safeValue}%`,
                ];

                if (!Number.isNaN(numericValue)) {
                    filters.push(
                        `article_id.eq.${numericValue}`
                    );
                }

                query = query.or(
                    filters.join(",")
                );
            }
        }

        if (currentSelectedCustomerId !== null) {
            query = query.eq(
                "customer_id",
                currentSelectedCustomerId
            );
        } else {
            const value =
                currentCustomerSearch.trim();

            if (value) {
                const safeValue =
                    sanitizePostgrestValue(value);
                const numericValue =
                    Number(safeValue);

                const filters = [
                    `customer_name.ilike.%${safeValue}%`,
                ];

                if (!Number.isNaN(numericValue)) {
                    filters.push(
                        `customer_id.eq.${numericValue}`
                    );
                }

                query = query.or(
                    filters.join(",")
                );
            }
        }

        if (currentFromDate) {
            query = query.gte(
                "issued_at",
                toArgentinaDayStartUtc(currentFromDate)
            );
        }

        if (currentToDate) {
            query = query.lt(
                "issued_at",
                toArgentinaNextDayUtc(currentToDate)
            );
        }

        const from =
            targetPage * PAGE_SIZE;
        const to =
            from + PAGE_SIZE - 1;

        query = query
            .order(
                "issued_at",
                {
                    ascending: false,
                    nullsFirst: false,
                }
            )
            .order(
                "erp_row_id",
                {
                    ascending: false,
                }
            )
            .range(from, to);

        const {
            data,
            error,
            count,
        } = await query;

        if (error) {
            console.error(
                "Error cargando histórico:",
                error
            );
            setRows([]);
            setTotalRows(0);
            setError(error.message);
            setLoading(false);
            return;
        }

        setRows(
            (data ?? []) as ArticleHistoryRow[]
        );
        setTotalRows(
            count ?? 0
        );

        setPage(targetPage);

        const params =
            new URLSearchParams();

        if (
            currentArticleSearch.trim()
        ) {
            params.set(
                "article",
                currentArticleSearch.trim()
            );
        }

        if (
            currentSelectedArticleId !== null
        ) {
            params.set(
                "articleId",
                String(currentSelectedArticleId)
            );
        }

        if (
            currentCustomerSearch.trim()
        ) {
            params.set(
                "customer",
                currentCustomerSearch.trim()
            );
        }

        if (
            currentSelectedCustomerId !== null
        ) {
            params.set(
                "customerId",
                String(currentSelectedCustomerId)
            );
        }

        if (currentFromDate) {
            params.set(
                "fromDate",
                currentFromDate
            );
        }

        if (currentToDate) {
            params.set(
                "toDate",
                currentToDate
            );
        }

        if (targetPage > 0) {
            params.set(
                "page",
                String(targetPage)
            );
        }

        const queryString =
            params.toString();

        window.history.replaceState(
            null,
            "",
            queryString
                ? `/historico-articulos?${queryString}`
                : "/historico-articulos"
        );

        setLoading(false);
    }

    function handleSubmit(
        event: FormEvent
    ) {
        event.preventDefault();
        runSearch(0);
    }

    function clearFilters() {
        setArticleSearch("");
        setCustomerSearch("");
        setSelectedArticleId(null);
        setSelectedCustomerId(null);
        setFromDate("");
        setToDate("");
        setArticleSuggestions([]);
        setCustomerSuggestions([]);

        runSearch(0, {
            articleSearch: "",
            customerSearch: "",
            selectedArticleId: null,
            selectedCustomerId: null,
            fromDate: "",
            toDate: "",
        });
    }

    const documentTypeMap =
        useMemo(() => {
            const map =
                new Map<number, DocumentType>();

            for (const type of documentTypes) {
                map.set(
                    Number(type.erp_id),
                    type
                );
            }

            return map;
        }, [documentTypes]);

    function getDocumentInfo(
        documentType: number | null | undefined
    ) {
        const type =
            documentTypeMap.get(
                Number(documentType)
            );

        const fallback =
            fallbackDocumentInfo(
                documentType
            );

        return {
            name:
                type?.name ||
                fallback.name,
            abbreviation:
                type?.abbreviation ||
                fallback.abbreviation,
        };
    }

    const totalPages =
        Math.max(
            1,
            Math.ceil(
                totalRows / PAGE_SIZE
            )
        );

    const hasFilters =
        Boolean(
            articleSearch.trim() ||
            customerSearch.trim() ||
            fromDate ||
            toDate
        );

    function buildReturnUrl() {
        const params =
            new URLSearchParams();

        if (articleSearch.trim()) {
            params.set(
                "article",
                articleSearch.trim()
            );
        }

        if (selectedArticleId !== null) {
            params.set(
                "articleId",
                String(selectedArticleId)
            );
        }

        if (customerSearch.trim()) {
            params.set(
                "customer",
                customerSearch.trim()
            );
        }

        if (selectedCustomerId !== null) {
            params.set(
                "customerId",
                String(selectedCustomerId)
            );
        }

        if (fromDate) {
            params.set(
                "fromDate",
                fromDate
            );
        }

        if (toDate) {
            params.set(
                "toDate",
                toDate
            );
        }

        if (page > 0) {
            params.set(
                "page",
                String(page)
            );
        }

        const queryString =
            params.toString();

        return queryString
            ? `/historico-articulos?${queryString}`
            : "/historico-articulos";
    }

    return (
        <main className="min-h-screen bg-slate-50 text-gray-900">
            <LoadingOverlay
                visible={loading}
                text="Cargando movimientos..."
            />

            <div className="h-1.5 w-full bg-red-700" />

            <header className="border-b bg-white shadow-sm">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
                    <div className="flex min-w-0 items-center gap-4">
                        <NavigationLoadingLink
                            href="/"
                            loadingText="Volviendo a clientes..."
                            className="flex h-16 w-40 shrink-0 items-center justify-center sm:h-20 sm:w-48"
                        >
                            <Image
                                src="/logo.JPG"
                                alt="La Casa del Tren Delantero"
                                width={220}
                                height={90}
                                priority
                                className="h-auto max-h-full w-auto object-contain"
                            />
                        </NavigationLoadingLink>

                        <div className="hidden border-l border-gray-200 pl-4 sm:block">
                            <h1 className="text-xl font-bold text-gray-900 lg:text-2xl">
                                Histórico de artículos
                            </h1>

                            <p className="mt-1 text-sm text-gray-500">
                                Consulta de ventas y movimientos sincronizados desde TD
                            </p>
                        </div>
                    </div>

                    <div className="hidden items-center gap-3 md:flex">
                        <NavigationLoadingLink
                            href="/"
                            loadingText="Volviendo a clientes..."
                            className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                            Clientes
                        </NavigationLoadingLink>

                        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2">
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
                </div>
            </header>

            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
                <div className="mb-6 sm:hidden">
                    <h1 className="text-2xl font-bold text-gray-900">
                        Histórico de artículos
                    </h1>

                    <p className="mt-1 text-sm text-gray-500">
                        Buscá qué artículos se vendieron, a quién, cuándo y quién confeccionó el comprobante.
                    </p>

                    <div className="mt-4 grid gap-3">
                        <NavigationLoadingLink
                            href="/"
                            loadingText="Volviendo a clientes..."
                            className="flex w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 shadow-sm"
                        >
                            ← Volver a clientes
                        </NavigationLoadingLink>

                        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />

                            <div>
                                <p className="text-xs font-medium text-gray-500">
                                    Última sincronización
                                </p>

                                <p className="mt-0.5 text-sm font-semibold text-gray-900">
                                    {lastSync
                                        ? formatDateTime(lastSync)
                                        : "Sin información"}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <section className="mb-6 overflow-visible rounded-2xl border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-100 px-5 py-4">
                        <div className="flex items-center gap-3">
                            <div className="h-6 w-1 rounded-full bg-red-700" />

                            <div>
                                <h2 className="font-semibold text-gray-900">
                                    Buscar movimientos
                                </h2>

                                <p className="text-sm text-gray-500">
                                    Podés buscar solo por artículo, solo por cliente o combinar ambos.
                                </p>
                            </div>
                        </div>
                    </div>

                    <form
                        onSubmit={handleSubmit}
                        className="p-5"
                    >
                        <div className="grid gap-4 lg:grid-cols-2">
                            <div className="relative">
                                <label
                                    htmlFor="article-search"
                                    className="mb-2 block text-sm font-medium text-gray-700"
                                >
                                    Artículo
                                </label>

                                <input
                                    id="article-search"
                                    type="text"
                                    autoComplete="off"
                                    placeholder="Ej: 25574, 50-BA358, bomba de agua..."
                                    value={articleSearch}
                                    onFocus={() =>
                                        setShowArticleSuggestions(true)
                                    }
                                    onBlur={() =>
                                        setTimeout(
                                            () =>
                                                setShowArticleSuggestions(false),
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
                                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-red-600 focus:ring-2 focus:ring-red-100"
                                />

                                {showArticleSuggestions &&
                                    articleSearch.trim().length >= 2 &&
                                    (articleSuggestions.length > 0 ||
                                        suggestionsLoading) && (
                                        <div className="absolute z-30 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl">
                                            {suggestionsLoading &&
                                                articleSuggestions.length === 0 && (
                                                    <p className="px-4 py-3 text-sm text-gray-500">
                                                        Buscando artículos...
                                                    </p>
                                                )}

                                            {articleSuggestions.map(
                                                (article) => (
                                                    <button
                                                        key={
                                                            article.article_id
                                                        }
                                                        type="button"
                                                        onMouseDown={(
                                                            event
                                                        ) =>
                                                            event.preventDefault()
                                                        }
                                                        onClick={() => {
                                                            setSelectedArticleId(
                                                                article.article_id
                                                            );
                                                            setArticleSearch(
                                                                `${article.article_code ||
                                                                article.article_id
                                                                } - ${article.article_name ||
                                                                "Sin descripción"
                                                                }`
                                                            );
                                                            setShowArticleSuggestions(
                                                                false
                                                            );
                                                        }}
                                                        className="block w-full border-b border-gray-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-red-50"
                                                    >
                                                        <p className="text-sm font-bold text-gray-900">
                                                            {article.article_code ||
                                                                `ID ${article.article_id}`}
                                                        </p>

                                                        <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                                                            {article.article_name ||
                                                                "Sin descripción"}
                                                        </p>
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    )}
                            </div>

                            <div className="relative">
                                <label
                                    htmlFor="customer-search"
                                    className="mb-2 block text-sm font-medium text-gray-700"
                                >
                                    Cliente
                                </label>

                                <input
                                    id="customer-search"
                                    type="text"
                                    autoComplete="off"
                                    placeholder="Ej: REPETTI, 343, IMPULSO..."
                                    value={customerSearch}
                                    onFocus={() =>
                                        setShowCustomerSuggestions(true)
                                    }
                                    onBlur={() =>
                                        setTimeout(
                                            () =>
                                                setShowCustomerSuggestions(false),
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
                                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-red-600 focus:ring-2 focus:ring-red-100"
                                />

                                {showCustomerSuggestions &&
                                    customerSearch.trim().length >= 2 &&
                                    (customerSuggestions.length > 0 ||
                                        suggestionsLoading) && (
                                        <div className="absolute z-30 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl">
                                            {suggestionsLoading &&
                                                customerSuggestions.length === 0 && (
                                                    <p className="px-4 py-3 text-sm text-gray-500">
                                                        Buscando clientes...
                                                    </p>
                                                )}

                                            {customerSuggestions.map(
                                                (customer) => (
                                                    <button
                                                        key={
                                                            customer.customer_id
                                                        }
                                                        type="button"
                                                        onMouseDown={(
                                                            event
                                                        ) =>
                                                            event.preventDefault()
                                                        }
                                                        onClick={() => {
                                                            setSelectedCustomerId(
                                                                customer.customer_id
                                                            );
                                                            setCustomerSearch(
                                                                `${customer.customer_id
                                                                } - ${customer.customer_name ||
                                                                "Sin nombre"
                                                                }`
                                                            );
                                                            setShowCustomerSuggestions(
                                                                false
                                                            );
                                                        }}
                                                        className="block w-full border-b border-gray-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-red-50"
                                                    >
                                                        <p className="text-sm font-bold text-gray-900">
                                                            {customer.customer_name ||
                                                                "Sin nombre"}
                                                        </p>

                                                        <p className="mt-1 text-xs text-gray-500">
                                                            Código{" "}
                                                            {
                                                                customer.customer_id
                                                            }
                                                        </p>
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    )}
                            </div>
                        </div>

                        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
                            <div className="min-w-0">
                                <label
                                    htmlFor="from-date"
                                    className="mb-2 block text-sm font-medium text-gray-700"
                                >
                                    Desde
                                </label>

                                <input
                                    id="from-date"
                                    type="date"
                                    value={fromDate}
                                    onChange={(event) =>
                                        setFromDate(
                                            event.target.value
                                        )
                                    }
                                    className="block w-full min-w-0 max-w-full appearance-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
                                />
                            </div>

                            <div className="min-w-0">
                                <label
                                    htmlFor="to-date"
                                    className="mb-2 block text-sm font-medium text-gray-700"
                                >
                                    Hasta
                                </label>

                                <input
                                    id="to-date"
                                    type="date"
                                    value={toDate}
                                    onChange={(event) =>
                                        setToDate(
                                            event.target.value
                                        )
                                    }
                                    className="block w-full min-w-0 max-w-full appearance-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition focus:border-red-600 focus:ring-2 focus:ring-red-100"
                                />
                            </div>

                            <div className="sm:self-end">
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="flex w-full items-center justify-center rounded-xl bg-red-700 px-6 py-3 font-bold text-white shadow-sm transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
                                >
                                    {loading ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <span
                                                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                                                aria-hidden="true"
                                            />
                                            Buscando...
                                        </span>
                                    ) : (
                                        "Buscar"
                                    )}
                                </button>
                            </div>

                            <div className="sm:self-end">
                                <button
                                    type="button"
                                    onClick={clearFilters}
                                    disabled={loading}
                                    className="flex w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-6 py-3 font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 lg:w-auto"
                                >
                                    Limpiar
                                </button>
                            </div>
                        </div>

                        {hasFilters && (
                            <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                                {selectedArticleId !== null && (
                                    <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
                                        Artículo ID{" "}
                                        {selectedArticleId}
                                    </span>
                                )}

                                {selectedCustomerId !== null && (
                                    <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
                                        Cliente{" "}
                                        {selectedCustomerId}
                                    </span>
                                )}

                                {fromDate && (
                                    <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700">
                                        Desde {fromDate}
                                    </span>
                                )}

                                {toDate && (
                                    <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700">
                                        Hasta {toDate}
                                    </span>
                                )}
                            </div>
                        )}
                    </form>
                </section>

                {error && (
                    <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
                        {error}
                    </div>
                )}

                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 className="font-semibold text-gray-900">
                            Movimientos encontrados
                        </h2>

                        <p className="mt-1 text-sm text-gray-500">
                            {loading
                                ? "Consultando histórico..."
                                : `${totalRows} ${totalRows === 1
                                    ? "movimiento"
                                    : "movimientos"
                                }`}
                        </p>
                    </div>

                    {totalRows > 0 && (
                        <span className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 shadow-sm">
                            Página {page + 1} de{" "}
                            {totalPages}
                        </span>
                    )}
                </div>

                {loading ? (
                    <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                        <div className="flex items-center justify-center gap-3">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-red-700" />

                            <p className="text-sm text-gray-600">
                                Cargando movimientos...
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:block">
                            <div>
                                <table className="w-full table-fixed">
                                    <thead>
                                        <tr className="bg-gray-50">
                                            <th className="w-[12%] px-3 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                Fecha
                                            </th>

                                            <th className="w-[21%] px-3 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                Cliente
                                            </th>

                                            <th className="w-[31%] px-3 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                Artículo
                                            </th>

                                            <th className="w-[15%] px-3 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                Comprobante
                                            </th>

                                            <th className="w-[6%] px-3 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                Cant.
                                            </th>

                                            <th className="w-[7%] px-3 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                Usuario
                                            </th>

                                            <th className="w-[8%] px-3 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                Precio
                                            </th>

                                        </tr>
                                    </thead>

                                    <tbody>
                                        {rows.map((row) => {
                                            const document =
                                                getDocumentInfo(
                                                    row.document_type
                                                );

                                            const returnUrl =
                                                buildReturnUrl();

                                            const href =
                                                row.customer_id &&
                                                    row.invoice_id
                                                    ? `/clientes/${row.customer_id}/comprobantes/${row.invoice_id}?from=${encodeURIComponent(
                                                        returnUrl
                                                    )}`
                                                    : null;

                                            return (
                                                <tr
                                                    key={row.erp_row_id}
                                                    className="border-t border-gray-100 align-top transition hover:bg-red-50/30"
                                                >
                                                    <td className="px-3 py-4 align-top">
                                                        <p className="whitespace-nowrap text-sm font-semibold text-gray-900">
                                                            {formatDate(
                                                                row.issued_at
                                                            )}
                                                        </p>

                                                        <p className="mt-1 whitespace-nowrap text-xs font-medium text-gray-500">
                                                            {formatTime(
                                                                row.issued_at
                                                            )}
                                                        </p>
                                                    </td>

                                                    <td className="px-3 py-4 align-top">
                                                        <p className="break-words text-sm font-bold text-gray-900">
                                                            {row.customer_name ||
                                                                "-"}
                                                        </p>
                                                        <p className="mt-1 text-xs text-gray-400">
                                                            Código{" "}
                                                            {row.customer_id ??
                                                                "-"}
                                                        </p>
                                                    </td>

                                                    <td className="px-3 py-4 align-top">
                                                        <p className="break-words text-sm font-bold text-gray-900">
                                                            {row.article_code ||
                                                                `ID ${row.article_id ??
                                                                "-"
                                                                }`}
                                                        </p>
                                                        <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                                                            {row.article_name ||
                                                                "-"}
                                                        </p>
                                                    </td>

                                                    <td className="px-3 py-4 align-top">
                                                        {href ? (
                                                            <NavigationLoadingLink
                                                                href={href}
                                                                loadingText="Abriendo comprobante..."
                                                                className="group inline-flex max-w-full items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700 shadow-sm transition hover:border-red-700 hover:bg-red-700 hover:text-white"
                                                            >
                                                                <span>
                                                                    {
                                                                        document.abbreviation
                                                                    }
                                                                    -
                                                                    {
                                                                        row.document_number
                                                                    }
                                                                </span>

                                                                <span
                                                                    aria-hidden="true"
                                                                    className="transition-transform group-hover:translate-x-0.5"
                                                                >
                                                                    →
                                                                </span>
                                                            </NavigationLoadingLink>
                                                        ) : (
                                                            "-"
                                                        )}
                                                    </td>

                                                    <td className="whitespace-nowrap px-3 py-4 text-right text-sm font-semibold text-gray-900">
                                                        {formatQuantity(
                                                            row.quantity
                                                        )}
                                                    </td>

                                                    <td className="whitespace-nowrap px-3 py-4 text-sm font-medium text-gray-700">
                                                        {row.user_name || "-"}
                                                    </td>

                                                    <td className="whitespace-nowrap px-3 py-4 text-right text-sm font-semibold text-gray-900">
                                                        {formatMoney(
                                                            row.unit_price
                                                        )}
                                                    </td>

                                                </tr>
                                            );
                                        })}

                                        {rows.length === 0 && (
                                            <tr>
                                                <td
                                                    colSpan={7}
                                                    className="px-6 py-14 text-center text-gray-500"
                                                >
                                                    {searched
                                                        ? "No se encontraron movimientos con esos filtros."
                                                        : "Realizá una búsqueda para consultar el histórico."}
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="grid gap-4 lg:hidden">
                            {rows.map((row) => {
                                const document =
                                    getDocumentInfo(
                                        row.document_type
                                    );

                                const returnUrl =
                                    buildReturnUrl();

                                const href =
                                    row.customer_id &&
                                        row.invoice_id
                                        ? `/clientes/${row.customer_id}/comprobantes/${row.invoice_id}?from=${encodeURIComponent(
                                            returnUrl
                                        )}`
                                        : null;

                                return (
                                    <article
                                        key={row.erp_row_id}
                                        className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
                                    >
                                        <div className="border-b border-gray-100 px-5 py-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                                                        Artículo
                                                    </p>

                                                    <h3 className="mt-1 text-lg font-bold text-gray-900">
                                                        {row.article_code ||
                                                            `ID ${row.article_id ??
                                                            "-"
                                                            }`}
                                                    </h3>
                                                </div>

                                            </div>

                                            <p className="mt-2 text-sm leading-5 text-gray-500">
                                                {row.article_name ||
                                                    "-"}
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-5 py-5">
                                            <div className="col-span-2">
                                                <p className="text-xs text-gray-500">
                                                    Cliente
                                                </p>

                                                <p className="mt-1 font-bold text-gray-900">
                                                    {row.customer_name ||
                                                        "-"}
                                                </p>

                                                <p className="mt-0.5 text-xs text-gray-400">
                                                    Código{" "}
                                                    {row.customer_id ??
                                                        "-"}
                                                </p>
                                            </div>

                                            <div>
                                                <p className="text-xs text-gray-500">
                                                    Fecha
                                                </p>

                                                <p className="mt-1 text-sm font-semibold text-gray-900">
                                                    {formatDate(
                                                        row.issued_at
                                                    )}
                                                </p>

                                                <p className="mt-0.5 text-xs font-medium text-gray-500">
                                                    {formatTime(
                                                        row.issued_at
                                                    )}
                                                </p>
                                            </div>

                                            <div>
                                                <p className="text-xs text-gray-500">
                                                    Usuario
                                                </p>

                                                <p className="mt-1 text-sm font-semibold text-gray-900">
                                                    {row.user_name ||
                                                        "-"}
                                                </p>
                                            </div>

                                            <div>
                                                <p className="text-xs text-gray-500">
                                                    Cantidad
                                                </p>

                                                <p className="mt-1 font-bold text-gray-900">
                                                    {formatQuantity(
                                                        row.quantity
                                                    )}
                                                </p>
                                            </div>

                                            <div>
                                                <p className="text-xs text-gray-500">
                                                    Precio
                                                </p>

                                                <p className="mt-1 font-bold text-gray-900">
                                                    {formatMoney(
                                                        row.unit_price
                                                    )}
                                                </p>
                                            </div>


                                            <div>
                                                <p className="text-xs text-gray-500">
                                                    Comprobante
                                                </p>

                                                <p className="mt-1 font-bold text-gray-900">
                                                    {
                                                        document.abbreviation
                                                    }
                                                    -
                                                    {
                                                        row.document_number
                                                    }
                                                </p>
                                            </div>
                                        </div>

                                        {href && (
                                            <div className="border-t border-gray-100 bg-gray-50 p-4">
                                                <NavigationLoadingLink
                                                    href={href}
                                                    loadingText="Abriendo comprobante..."
                                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-red-800"
                                                >
                                                    Ver comprobante
                                                    <span aria-hidden="true">
                                                        →
                                                    </span>
                                                </NavigationLoadingLink>
                                            </div>
                                        )}
                                    </article>
                                );
                            })}

                            {rows.length === 0 && (
                                <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500 shadow-sm">
                                    No se encontraron movimientos con esos filtros.
                                </div>
                            )}
                        </div>
                    </>
                )}

                {!loading &&
                    totalRows > PAGE_SIZE && (
                        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                            <p className="text-sm text-gray-500">
                                Mostrando{" "}
                                {page * PAGE_SIZE + 1} a{" "}
                                {Math.min(
                                    (page + 1) *
                                    PAGE_SIZE,
                                    totalRows
                                )}{" "}
                                de {totalRows}
                            </p>

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    disabled={loading || page === 0}
                                    onClick={() =>
                                        runSearch(
                                            page - 1
                                        )
                                    }
                                    className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    ← Anterior
                                </button>

                                <button
                                    type="button"
                                    disabled={
                                        loading ||
                                        page + 1 >=
                                        totalPages
                                    }
                                    onClick={() =>
                                        runSearch(
                                            page + 1
                                        )
                                    }
                                    className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Siguiente →
                                </button>
                            </div>
                        </div>
                    )}
            </div>
        </main>
    );
}

export default function ArticleHistoryPage() {
    return (
        <Suspense
            fallback={
                <main className="min-h-screen bg-slate-50 text-gray-900">
                    <div className="h-1.5 w-full bg-red-700" />

                    <div className="mx-auto flex min-h-[70vh] max-w-7xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
                        <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-red-700" />

                            <p className="text-sm font-medium text-gray-600">
                                Cargando histórico de artículos...
                            </p>
                        </div>
                    </div>
                </main>
            }
        >
            <ArticleHistoryContent />
        </Suspense>
    );
}

