"use client";

import Image from "next/image";
import NavigationLoadingLink from "@/components/NavigationLoadingLink";
import LogoutButton from "@/components/LogoutButton";

type ActiveSection =
    | "clientes"
    | "historico"
    | "stock"
    | "estadisticas";

type AppNavbarProps = {
    active: ActiveSection;
    title: string;
    subtitle: string;
    loggedUsername?: string;
    lastSync?: string | null;
};

const navItems: {
    key: ActiveSection;
    label: string;
    href: string;
    loadingText: string;
}[] = [
    {
        key: "clientes",
        label: "Clientes",
        href: "/clientes",
        loadingText: "Abriendo clientes...",
    },
    {
        key: "historico",
        label: "Histórico",
        href: "/historico-articulos",
        loadingText: "Abriendo histórico...",
    },
    {
        key: "stock",
        label: "Stock",
        href: "/stock",
        loadingText: "Abriendo stock...",
    },
    {
        key: "estadisticas",
        label: "Estadísticas",
        href: "/estadisticas-ventas",
        loadingText: "Abriendo estadísticas...",
    },
];

export default function AppNavbar({
    active,
    title,
    subtitle,
    loggedUsername,
    lastSync,
}: AppNavbarProps) {
    return (
        <>
            <div className="h-1.5 w-full bg-red-700" />

            <header className="border-b border-gray-200 bg-white shadow-sm">
                <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 lg:px-8">
                    {/* =====================================================
                        DESKTOP / TABLET GRANDE
                    ===================================================== */}
                    <div className="hidden items-center gap-4 lg:flex">
                        {/* LOGO */}
                        <NavigationLoadingLink
                            href="/clientes"
                            loadingText="Abriendo clientes..."
                            className="flex h-[72px] w-[180px] shrink-0 items-center justify-start xl:w-[200px]"
                        >
                            <Image
                                src="/logo.jpg"
                                alt="La Casa del Tren Delantero"
                                width={220}
                                height={90}
                                priority
                                className="h-auto max-h-full w-auto object-contain"
                            />
                        </NavigationLoadingLink>

                        {/* TÍTULO */}
                        <div className="min-w-[190px] max-w-[230px] shrink-0 border-l border-gray-200 pl-4 xl:min-w-[230px] xl:max-w-[280px] 2xl:min-w-[290px] 2xl:max-w-[330px]">
                            <h1 className="text-xl font-bold leading-tight text-gray-900 xl:text-2xl">
                                {title}
                            </h1>

                            <p className="mt-1 hidden text-sm leading-5 text-gray-500 xl:block">
                                {subtitle}
                            </p>
                        </div>

                        {/* NAVEGACIÓN */}
                        <nav className="ml-auto flex min-w-0 items-center gap-2 xl:gap-2.5">
                            {navItems.map((item) => {
                                const isActive =
                                    active === item.key;

                                return (
                                    <NavigationLoadingLink
                                        key={item.key}
                                        href={item.href}
                                        loadingText={
                                            item.loadingText
                                        }
                                        className={
                                            isActive
                                                ? "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700 shadow-sm xl:px-4"
                                                : "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-700 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 xl:px-4"
                                        }
                                    >
                                        {item.label}
                                    </NavigationLoadingLink>
                                );
                            })}

                            <div className="shrink-0">
                                <LogoutButton />
                            </div>

                            {/* USUARIO */}
                            {loggedUsername && (
                                <div className="hidden shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm xl:flex">
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-sm font-extrabold uppercase text-red-700">
                                        {loggedUsername
                                            .charAt(0)
                                            .toUpperCase()}
                                    </div>

                                    <div className="min-w-0">
                                        <p className="text-[11px] font-medium leading-none text-gray-400">
                                            Usuario
                                        </p>

                                        <p className="mt-1 max-w-[95px] truncate text-sm font-bold leading-none text-gray-900 2xl:max-w-[130px]">
                                            {
                                                loggedUsername
                                            }
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* SINCRONIZACIÓN */}
                            <div className="hidden shrink-0 items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 2xl:flex">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />

                                <div>
                                    <p className="whitespace-nowrap text-[11px] font-medium text-gray-500">
                                        Última sincronización
                                    </p>

                                    <p className="mt-0.5 whitespace-nowrap text-sm font-bold text-gray-900">
                                        {lastSync ||
                                            "Sin información"}
                                    </p>
                                </div>
                            </div>
                        </nav>
                    </div>

                    {/* =====================================================
                        TABLET / PANTALLAS INTERMEDIAS
                    ===================================================== */}
                    <div className="hidden md:block lg:hidden">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex min-w-0 items-center gap-4">
                                <NavigationLoadingLink
                                    href="/clientes"
                                    loadingText="Abriendo clientes..."
                                    className="flex h-16 w-40 shrink-0 items-center justify-start"
                                >
                                    <Image
                                        src="/logo.jpg"
                                        alt="La Casa del Tren Delantero"
                                        width={200}
                                        height={80}
                                        priority
                                        className="h-auto max-h-full w-auto object-contain"
                                    />
                                </NavigationLoadingLink>

                                <div className="min-w-0 border-l border-gray-200 pl-4">
                                    <h1 className="text-xl font-bold leading-tight text-gray-900">
                                        {title}
                                    </h1>
                                </div>
                            </div>

                            <LogoutButton />
                        </div>

                        <nav className="mt-4 grid grid-cols-4 gap-2">
                            {navItems.map((item) => {
                                const isActive =
                                    active === item.key;

                                return (
                                    <NavigationLoadingLink
                                        key={item.key}
                                        href={item.href}
                                        loadingText={
                                            item.loadingText
                                        }
                                        className={
                                            isActive
                                                ? "flex items-center justify-center whitespace-nowrap rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700"
                                                : "flex items-center justify-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
                                        }
                                    >
                                        {item.label}
                                    </NavigationLoadingLink>
                                );
                            })}
                        </nav>

                        <div className="mt-3 flex items-center justify-between gap-3">
                            {loggedUsername && (
                                <div className="flex min-w-0 items-center gap-2 text-sm">
                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-xs font-bold text-red-700">
                                        {loggedUsername
                                            .charAt(0)
                                            .toUpperCase()}
                                    </div>

                                    <span className="truncate font-semibold text-gray-700">
                                        {loggedUsername}
                                    </span>
                                </div>
                            )}

                            <div className="flex shrink-0 items-center gap-2 text-xs text-gray-600">
                                <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                                <span>
                                    {lastSync ||
                                        "Sin información"}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* =====================================================
                        MOBILE
                    ===================================================== */}
                    <div className="md:hidden">
                        <div className="flex items-center justify-between gap-3">
                            <NavigationLoadingLink
                                href="/clientes"
                                loadingText="Abriendo clientes..."
                                className="flex h-14 w-32 shrink-0 items-center justify-start"
                            >
                                <Image
                                    src="/logo.jpg"
                                    alt="La Casa del Tren Delantero"
                                    width={180}
                                    height={75}
                                    priority
                                    className="h-auto max-h-full w-auto object-contain"
                                />
                            </NavigationLoadingLink>

                            <LogoutButton />
                        </div>

                        <div className="mt-4">
                            <h1 className="text-xl font-bold leading-tight text-gray-900">
                                {title}
                            </h1>

                            <p className="mt-1 text-sm leading-5 text-gray-500">
                                {subtitle}
                            </p>
                        </div>

                        <nav className="mt-4 grid grid-cols-2 gap-2">
                            {navItems.map((item) => {
                                const isActive =
                                    active === item.key;

                                return (
                                    <NavigationLoadingLink
                                        key={item.key}
                                        href={item.href}
                                        loadingText={
                                            item.loadingText
                                        }
                                        className={
                                            isActive
                                                ? "flex min-h-[46px] items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm font-bold text-red-700"
                                                : "flex min-h-[46px] items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-700 shadow-sm"
                                        }
                                    >
                                        {item.label}
                                    </NavigationLoadingLink>
                                );
                            })}
                        </nav>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            {loggedUsername && (
                                <div className="flex min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-xs font-extrabold uppercase text-red-700">
                                        {loggedUsername
                                            .charAt(0)
                                            .toUpperCase()}
                                    </div>

                                    <span className="max-w-[130px] truncate text-sm font-bold text-gray-900">
                                        {loggedUsername}
                                    </span>
                                </div>
                            )}

                            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />

                                <span className="text-xs font-medium text-gray-600">
                                    {lastSync ||
                                        "Sin información"}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </header>
        </>
    );
}