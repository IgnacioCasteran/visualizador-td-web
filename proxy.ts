import { createServerClient } from "@supabase/ssr";
import {
  NextResponse,
  type NextRequest,
} from "next/server";

export async function proxy(
  request: NextRequest
) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(
            ({ name, value }) => {
              request.cookies.set(
                name,
                value
              );
            }
          );

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(
            ({
              name,
              value,
              options,
            }) => {
              response.cookies.set(
                name,
                value,
                options
              );
            }
          );
        },
      },
    }
  );

  const pathname =
    request.nextUrl.pathname;

  const isLoginPage =
    pathname === "/login";

  /*
   * =========================================================
   * VALIDAR SESIÓN
   * =========================================================
   */

  const {
    data,
    error,
  } = await supabase.auth.getClaims();

  const isAuthenticated =
    !error &&
    Boolean(data?.claims);

  /*
   * =========================================================
   * SIN SESIÓN
   * =========================================================
   */

  if (
    !isAuthenticated &&
    !isLoginPage
  ) {
    const url =
      request.nextUrl.clone();

    url.pathname = "/login";
    url.search = "";

    return NextResponse.redirect(url);
  }

  /*
   * =========================================================
   * YA LOGUEADO Y EN /login
   * =========================================================
   */

  if (
    isAuthenticated &&
    isLoginPage
  ) {
    const url =
      request.nextUrl.clone();

    url.pathname =
      "/historico-articulos";

    url.search = "";

    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};