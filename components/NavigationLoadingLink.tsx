"use client";

import Link from "next/link";
import {
  type MouseEvent,
  type ReactNode,
  useState,
} from "react";
import LoadingOverlay from "@/components/LoadingOverlay";

type NavigationLoadingLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  loadingText?: string;
};

export default function NavigationLoadingLink({
  href,
  children,
  className,
  loadingText = "Cargando...",
}: NavigationLoadingLinkProps) {
  const [loading, setLoading] = useState(false);

  function handleClick(
    event: MouseEvent<HTMLAnchorElement>
  ) {
    // No mostramos el overlay si el usuario abre el enlace
    // en otra pestaña/ventana con Ctrl, Cmd, Shift, Alt o click medio.
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    setLoading(true);
  }

  return (
    <>
      <Link
        href={href}
        onClick={handleClick}
        className={className}
        aria-busy={loading}
      >
        {children}
      </Link>

      <LoadingOverlay
        visible={loading}
        text={loadingText}
      />
    </>
  );
}
