"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Customer = {
  erp_id: number;
  business_name: string | null;
  cuit: string | null;
  locality_name: string | null;
  zone: string | null;
  real_last_movement_at: string | null;
};

function formatCustomerCode(
  value: number | string | null | undefined
) {
  if (value === null || value === undefined) return "-";

  return String(value).padStart(5, "0");
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

export default function Home() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [zones, setZones] = useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [selectedZone, setSelectedZone] = useState("");

  const [loading, setLoading] = useState(false);
  const [zonesLoading, setZonesLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [lastSync, setLastSync] = useState<string | null>(null);

  /*
   * =========================================================
   * CARGA INICIAL
   * =========================================================
   */

  useEffect(() => {
    loadZones();
    loadLastSync();
  }, []);

  /*
   * =========================================================
   * ÚLTIMA SINCRONIZACIÓN COMPLETA
   * =========================================================
   *
   * IMPORTANTE:
   *
   * Ya no usamos sync_cursors.
   *
   * Leemos sync_status porque last_completed_at representa
   * el momento en el que terminó correctamente la
   * sincronización incremental completa:
   *
   * SQL SERVER LOCAL → SUPABASE
   *
   * =========================================================
   */

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

    /*
     * Solamente mostramos la fecha si la última
     * sincronización terminó correctamente.
     */
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

  /*
   * =========================================================
   * CARGAR ZONAS
   * =========================================================
   */

  async function loadZones() {
    setZonesLoading(true);

    try {
      const allZones: string[] = [];

      let from = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await supabase
          .from("customers")
          .select("zone")
          .not("zone", "is", null)
          .range(
            from,
            from + pageSize - 1
          );

        if (error) {
          throw error;
        }

        const rows = data ?? [];

        for (const row of rows) {
          const zone =
            row.zone?.trim();

          if (zone) {
            allZones.push(zone);
          }
        }

        if (
          rows.length <
          pageSize
        ) {
          break;
        }

        from += pageSize;
      }

      const uniqueZones =
        Array.from(
          new Set(allZones)
        ).sort((a, b) =>
          a.localeCompare(
            b,
            "es",
            {
              numeric: true,
            }
          )
        );

      setZones(uniqueZones);
    } catch (error) {
      console.error(
        "Error cargando zonas:",
        error
      );
    } finally {
      setZonesLoading(false);
    }
  }

  /*
   * =========================================================
   * BUSCAR CLIENTES
   * =========================================================
   */

  useEffect(() => {
    const timeout =
      setTimeout(() => {
        searchCustomers();
      }, 300);

    return () =>
      clearTimeout(timeout);
  }, [search, selectedZone]);

  async function searchCustomers() {
    setLoading(true);
    setError(null);

    /*
     * IMPORTANTE:
     *
     * Consultamos la VIEW:
     * customers_with_last_movement
     *
     * Esta vista calcula:
     *
     * MAX(account_movements.registered_at)
     *
     * para obtener el movimiento real más reciente.
     */

    let query = supabase
      .from(
        "customers_with_last_movement"
      )
      .select(`
        erp_id,
        business_name,
        cuit,
        locality_name,
        zone,
        real_last_movement_at
      `);

    /*
     * =====================================================
     * ZONA
     * =====================================================
     */

    if (selectedZone) {
      query = query.eq(
        "zone",
        selectedZone
      );
    }

    /*
     * =====================================================
     * BUSCADOR
     * =====================================================
     */

    const value = search.trim();

    if (value) {
      const numericValue =
        Number(value);

      const filters = [
        `business_name.ilike.%${value}%`,
        `cuit.ilike.%${value}%`,
        `locality_name.ilike.%${value}%`,
      ];

      if (
        !Number.isNaN(
          numericValue
        )
      ) {
        filters.push(
          `erp_id.eq.${numericValue}`
        );
      }

      query = query.or(
        filters.join(",")
      );
    }

    /*
     * =====================================================
     * ORDEN REAL POR MOVIMIENTO
     * =====================================================
     */

    query = query
      .order(
        "real_last_movement_at",
        {
          ascending: false,
          nullsFirst: false,
        }
      )
      .order(
        "business_name",
        {
          ascending: true,
        }
      )
      .limit(50);

    const { data, error } =
      await query;

    if (error) {
      console.error(error);

      setError(
        error.message
      );

      setCustomers([]);
    } else {
      setCustomers(
        data ?? []
      );
    }

    setLoading(false);
  }

  /*
   * =========================================================
   * FILTROS
   * =========================================================
   */

  const hasFilters =
    useMemo(() => {
      return Boolean(
        search.trim() ||
          selectedZone
      );
    }, [
      search,
      selectedZone,
    ]);

  function clearFilters() {
    setSearch("");
    setSelectedZone("");
  }

  /*
   * =========================================================
   * PANTALLA
   * =========================================================
   */

  return (
    <main className="min-h-screen bg-slate-50 text-gray-900">
      {/* BARRA ROJA */}

      <div className="h-1.5 w-full bg-red-700" />

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="border-b bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            {/* LOGO */}

            <div className="flex h-16 w-40 shrink-0 items-center justify-center sm:h-20 sm:w-48">
              <Image
                src="/logo.JPG"
                alt="La Casa del Tren Delantero"
                width={220}
                height={90}
                priority
                className="h-auto max-h-full w-auto object-contain"
              />
            </div>

            {/* TÍTULO */}

            <div className="hidden border-l border-gray-200 pl-4 sm:block">
              <h1 className="text-xl font-bold text-gray-900 lg:text-2xl">
                Visualizador de clientes
              </h1>

              <p className="mt-1 text-sm text-gray-500">
                Información sincronizada desde TD
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <Link
              href="/historico-articulos"
              className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 shadow-sm transition hover:border-red-700 hover:bg-red-700 hover:text-white"
            >
              Histórico de artículos
            </Link>

            {/* =================================================
                ÚLTIMA SINCRONIZACIÓN
            ================================================= */}

            <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />

            <div>
              <p className="text-xs font-medium text-gray-500">
                Última sincronización
              </p>

              <p className="mt-0.5 whitespace-nowrap text-sm font-semibold text-gray-900">
                {lastSync
                  ? formatDateTime(
                      lastSync
                    )
                  : "Sin información"}
              </p>
            </div>
            </div>
          </div>
        </div>
      </header>

      {/* =====================================================
          CONTENIDO
      ===================================================== */}

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* MOBILE TITLE */}

        <div className="mb-6 sm:hidden">
          <h1 className="text-2xl font-bold text-gray-900">
            Visualizador de clientes
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Consulta de clientes sincronizados desde el ERP
          </p>

          {/* ÚLTIMA SINCRONIZACIÓN MOBILE */}

          <div className="mt-4 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm md:hidden">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />

            <div>
              <p className="text-xs font-medium text-gray-500">
                Última sincronización
              </p>

              <p className="mt-0.5 text-sm font-semibold text-gray-900">
                {lastSync
                  ? formatDateTime(
                      lastSync
                    )
                  : "Sin información"}
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6 md:hidden">
          <Link
            href="/historico-articulos"
            className="flex w-full items-center justify-between rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-700 shadow-sm transition active:bg-red-100"
          >
            <span>Histórico de artículos</span>
            <span aria-hidden="true" className="text-lg">
              →
            </span>
          </Link>
        </div>

        {/* ===================================================
            FILTROS
        =================================================== */}

        <section className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="h-6 w-1 rounded-full bg-red-700" />

              <div>
                <h2 className="font-semibold text-gray-900">
                  Buscar clientes
                </h2>

                <p className="text-sm text-gray-500">
                  Buscá por nombre, código, CUIT, localidad o zona
                </p>
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="grid gap-4 md:grid-cols-[1fr_240px]">
              {/* BUSCADOR */}

              <div>
                <label
                  htmlFor="customer-search"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Cliente
                </label>

                <input
                  id="customer-search"
                  type="text"
                  placeholder="Ej: ABEZU, 00810, Villa Mercedes..."
                  value={search}
                  onChange={(e) =>
                    setSearch(
                      e.target.value
                    )
                  }
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-red-600 focus:ring-2 focus:ring-red-100"
                />
              </div>

              {/* ZONA */}

              <div>
                <label
                  htmlFor="zone-filter"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Zona
                </label>

                <select
                  id="zone-filter"
                  value={
                    selectedZone
                  }
                  onChange={(e) =>
                    setSelectedZone(
                      e.target.value
                    )
                  }
                  disabled={
                    zonesLoading
                  }
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition disabled:bg-gray-100 focus:border-red-600 focus:ring-2 focus:ring-red-100"
                >
                  <option value="">
                    {zonesLoading
                      ? "Cargando zonas..."
                      : "Todas las zonas"}
                  </option>

                  {zones.map(
                    (zone) => (
                      <option
                        key={zone}
                        value={zone}
                      >
                        Zona {zone}
                      </option>
                    )
                  )}
                </select>
              </div>
            </div>

            {/* FILTROS ACTIVOS */}

            {hasFilters && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                <div className="flex flex-wrap gap-2">
                  {selectedZone && (
                    <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
                      Zona{" "}
                      {selectedZone}
                    </span>
                  )}

                  {search && (
                    <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700">
                      Búsqueda:{" "}
                      {search}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={
                    clearFilters
                  }
                  className="text-sm font-medium text-red-700 hover:text-red-900"
                >
                  Limpiar filtros
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ===================================================
            LOADING
        =================================================== */}

        {loading && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-red-700" />

              <p className="text-sm text-gray-600">
                Buscando clientes...
              </p>
            </div>
          </div>
        )}

        {/* ===================================================
            ERROR
        =================================================== */}

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
            {error}
          </div>
        )}

        {!loading &&
          !error && (
            <>
              {/* =================================================
                  TÍTULO RESULTADOS
              ================================================= */}

              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-800">
                    {hasFilters
                      ? `${customers.length} resultados encontrados`
                      : "Clientes con movimientos recientes"}
                  </p>

                  <p className="mt-0.5 text-sm text-gray-500">
                    {hasFilters
                      ? "Ordenados por movimiento más reciente"
                      : "Mostrando los 50 clientes con movimientos más recientes"}
                  </p>
                </div>

                {!hasFilters && (
                  <span className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm">
                    Últimos 50
                  </span>
                )}
              </div>

              {/* =================================================
                  DESKTOP
              ================================================= */}

              <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:block">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Código
                        </th>

                        <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Cliente
                        </th>

                        <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Localidad
                        </th>

                        <th className="px-5 py-4 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Zona
                        </th>

                        <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                          CUIT
                        </th>

                        <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Último movimiento
                        </th>

                        <th className="px-5 py-4" />
                      </tr>
                    </thead>

                    <tbody>
                      {customers.map(
                        (customer) => (
                          <tr
                            key={
                              customer.erp_id
                            }
                            className="border-t border-gray-100 transition hover:bg-red-50/30"
                          >
                            {/* CÓDIGO */}

                            <td className="whitespace-nowrap px-5 py-4 font-semibold text-gray-900">
                              {formatCustomerCode(
                                customer.erp_id
                              )}
                            </td>

                            {/* CLIENTE */}

                            <td className="px-5 py-4 font-semibold text-gray-900">
                              {customer.business_name ||
                                "-"}
                            </td>

                            {/* LOCALIDAD */}

                            <td className="px-5 py-4 text-gray-600">
                              {customer.locality_name ||
                                "-"}
                            </td>

                            {/* ZONA */}

                            <td className="px-5 py-4 text-center">
                              {customer.zone ? (
                                <span className="inline-flex min-w-10 justify-center rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">
                                  {
                                    customer.zone
                                  }
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>

                            {/* CUIT */}

                            <td className="whitespace-nowrap px-5 py-4 text-gray-600">
                              {customer.cuit ||
                                "-"}
                            </td>

                            {/* ÚLTIMO MOVIMIENTO */}

                            <td className="whitespace-nowrap px-5 py-4 text-sm font-medium text-gray-700">
                              {formatDate(
                                customer.real_last_movement_at
                              )}
                            </td>

                            {/* VER */}

                            <td className="px-5 py-4 text-right">
                              <Link
                                href={`/clientes/${customer.erp_id}`}
                                className="inline-flex rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-800"
                              >
                                Ver
                              </Link>
                            </td>
                          </tr>
                        )
                      )}

                      {customers.length ===
                        0 && (
                        <tr>
                          <td
                            colSpan={
                              7
                            }
                            className="px-6 py-14 text-center text-gray-500"
                          >
                            No se encontraron clientes.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* =================================================
                  MOBILE
              ================================================= */}

              <div className="grid gap-4 md:hidden">
                {customers.map(
                  (customer) => (
                    <article
                      key={
                        customer.erp_id
                      }
                      className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
                    >
                      {/* CABECERA */}

                      <div className="border-b border-gray-100 px-5 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs uppercase tracking-wide text-gray-400">
                              Cliente
                            </p>

                            <h2 className="mt-1 text-lg font-bold text-gray-900">
                              {customer.business_name ||
                                "-"}
                            </h2>
                          </div>

                          {customer.zone && (
                            <span className="shrink-0 rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
                              Zona{" "}
                              {
                                customer.zone
                              }
                            </span>
                          )}
                        </div>
                      </div>

                      {/* DATOS */}

                      <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-5 py-5">
                        <div>
                          <p className="text-xs text-gray-500">
                            Código
                          </p>

                          <p className="mt-1 font-bold text-gray-900">
                            {formatCustomerCode(
                              customer.erp_id
                            )}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-gray-500">
                            Último movimiento
                          </p>

                          <p className="mt-1 font-medium text-gray-900">
                            {formatDate(
                              customer.real_last_movement_at
                            )}
                          </p>
                        </div>

                        <div className="col-span-2">
                          <p className="text-xs text-gray-500">
                            Localidad
                          </p>

                          <p className="mt-1 font-medium text-gray-900">
                            {customer.locality_name ||
                              "-"}
                          </p>
                        </div>

                        <div className="col-span-2">
                          <p className="text-xs text-gray-500">
                            CUIT
                          </p>

                          <p className="mt-1 font-medium text-gray-900">
                            {customer.cuit ||
                              "-"}
                          </p>
                        </div>
                      </div>

                      {/* BOTÓN */}

                      <div className="border-t border-gray-100 bg-gray-50 p-4">
                        <Link
                          href={`/clientes/${customer.erp_id}`}
                          className="flex w-full items-center justify-center rounded-xl bg-red-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-800"
                        >
                          Ver cliente
                        </Link>
                      </div>
                    </article>
                  )
                )}

                {customers.length ===
                  0 && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500 shadow-sm">
                    No se encontraron clientes.
                  </div>
                )}
              </div>
            </>
          )}
      </div>
    </main>
  );
}