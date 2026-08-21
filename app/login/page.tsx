"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import { useRouter } from "next/navigation";

import {
  Eye,
  EyeOff,
  LockKeyhole,
  LogIn,
  User,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import LoadingOverlay from "@/components/LoadingOverlay";

const USER_DOMAIN = "@visualizador.local";

export default function LoginPage() {
  const router = useRouter();

  const [username, setUsername] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [rememberMe, setRememberMe] =
    useState(true);

  const [showPassword, setShowPassword] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  /*
   * =========================================================
   * RECUPERAR USUARIO GUARDADO
   * =========================================================
   */

  useEffect(() => {
    const savedUsername =
      localStorage.getItem(
        "visualizador-username"
      );

    if (savedUsername) {
      setUsername(savedUsername);
      setRememberMe(true);
    }
  }, []);

  /*
   * =========================================================
   * LOGIN
   * =========================================================
   */

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const cleanUsername =
      username
        .trim()
        .toLowerCase();

    if (!cleanUsername) {
      setError(
        "Ingresá tu usuario."
      );

      return;
    }

    if (!password) {
      setError(
        "Ingresá tu contraseña."
      );

      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase =
        createClient();

      const email =
        `${cleanUsername}${USER_DOMAIN}`;

      const {
        error: loginError,
      } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

      /*
       * -----------------------------------------------------
       * ERROR DE CREDENCIALES
       * -----------------------------------------------------
       */

      if (loginError) {
        console.error(
          "Error de login:",
          loginError
        );

        setError(
          "Usuario o contraseña incorrectos."
        );

        setLoading(false);

        return;
      }

      /*
       * -----------------------------------------------------
       * RECORDAR USUARIO
       * -----------------------------------------------------
       */

      if (rememberMe) {
        localStorage.setItem(
          "visualizador-username",
          cleanUsername
        );
      } else {
        localStorage.removeItem(
          "visualizador-username"
        );
      }

      /*
       * -----------------------------------------------------
       * REDIRECCIÓN
       * -----------------------------------------------------
       */

      router.replace(
        "/historico-articulos"
      );

      router.refresh();
    } catch (loginException) {
      console.error(
        "Error iniciando sesión:",
        loginException
      );

      setError(
        "No se pudo iniciar sesión. Intentá nuevamente."
      );

      setLoading(false);
    }
  }

  /*
   * =========================================================
   * VISTA
   * =========================================================
   */

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-50 text-gray-900">
      {/* =====================================================
          LOADING
      ===================================================== */}

      <LoadingOverlay
        visible={loading}
        text="Iniciando sesión..."
      />

      {/* =====================================================
          BARRA SUPERIOR
      ===================================================== */}

      <div className="absolute left-0 top-0 z-20 h-1.5 w-full bg-red-700" />

      {/* =====================================================
          DECORACIÓN DE FONDO
      ===================================================== */}

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full bg-red-100/40 blur-3xl"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-slate-200/70 blur-3xl"
      />

      {/* =====================================================
          CONTENIDO
      ===================================================== */}

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
        <div className="w-full max-w-[440px]">

          {/* =================================================
              CARD
          ================================================= */}

          <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.12)]">

            {/* ===============================================
                CABECERA
            =============================================== */}

            <div className="border-b border-gray-100 px-6 pb-7 pt-8 text-center sm:px-9 sm:pb-8 sm:pt-9">

              {/* LOGO */}

              <div className="mx-auto flex h-[90px] w-full items-center justify-center">
                <img
                  src="/logo.jpg"
                  alt="La Casa del Tren Delantero"
                  className="max-h-[85px] w-auto max-w-[260px] object-contain"
                />
              </div>

              <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-[28px]">
                Iniciar sesión
              </h1>

              <p className="mt-2 text-sm leading-6 text-gray-500">
                Ingresá al Visualizador TD
              </p>
            </div>

            {/* ===============================================
                FORMULARIO
            =============================================== */}

            <form
              onSubmit={handleSubmit}
              className="space-y-5 px-6 py-7 sm:px-9 sm:py-8"
            >

              {/* =============================================
                  USUARIO
              ============================================= */}

              <div>
                <label
                  htmlFor="username"
                  className="mb-2 block text-sm font-bold text-gray-700"
                >
                  Usuario
                </label>

                <div className="relative">
                  <User
                    aria-hidden="true"
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
                  />

                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={(event) => {
                      setUsername(
                        event.target.value
                      );

                      if (error) {
                        setError(null);
                      }
                    }}
                    placeholder="Ingresa tu usuario"
                    disabled={loading}
                    className="block h-14 w-full rounded-xl border border-gray-300 bg-white py-3 pl-12 pr-4 text-base font-medium text-gray-900 outline-none transition placeholder:font-normal placeholder:text-gray-400 focus:border-red-600 focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-gray-50"
                  />
                </div>
              </div>

              {/* =============================================
                  CONTRASEÑA
              ============================================= */}

              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-bold text-gray-700"
                >
                  Contraseña
                </label>

                <div className="relative">
                  <LockKeyhole
                    aria-hidden="true"
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
                  />

                  <input
                    id="password"
                    name="password"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(
                        event.target.value
                      );

                      if (error) {
                        setError(null);
                      }
                    }}
                    placeholder="Ingresá tu contraseña"
                    disabled={loading}
                    className="block h-14 w-full rounded-xl border border-gray-300 bg-white py-3 pl-12 pr-12 text-base font-medium text-gray-900 outline-none transition placeholder:font-normal placeholder:text-gray-400 focus:border-red-600 focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-gray-50"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowPassword(
                        (current) =>
                          !current
                      )
                    }
                    disabled={loading}
                    aria-label={
                      showPassword
                        ? "Ocultar contraseña"
                        : "Mostrar contraseña"
                    }
                    className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              {/* =============================================
                  RECORDARME
              ============================================= */}

              <label className="flex cursor-pointer select-none items-center gap-3">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) =>
                    setRememberMe(
                      event.target.checked
                    )
                  }
                  disabled={loading}
                  className="h-5 w-5 cursor-pointer rounded border-gray-300 accent-red-700"
                />

                <span className="text-sm font-semibold text-gray-700">
                  Recordarme
                </span>
              </label>

              {/* =============================================
                  ERROR
              ============================================= */}

              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3.5"
                >
                  <p className="text-sm font-semibold leading-5 text-red-700">
                    {error}
                  </p>
                </div>
              )}

              {/* =============================================
                  INGRESAR
              ============================================= */}

              <button
                type="submit"
                disabled={loading}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-5 text-base font-bold text-white shadow-sm transition hover:bg-red-800 focus:outline-none focus:ring-4 focus:ring-red-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    />

                    <span>
                      Ingresando...
                    </span>
                  </>
                ) : (
                  <>
                    <LogIn
                      aria-hidden="true"
                      className="h-5 w-5"
                    />

                    <span>
                      Ingresar
                    </span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* =================================================
              PIE
          ================================================= */}

          <p className="mt-5 text-center text-xs font-medium text-gray-400">
            La Casa del Tren Delantero
          </p>
        </div>
      </div>
    </main>
  );
}