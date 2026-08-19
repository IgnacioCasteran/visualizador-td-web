"use client";

type LoadingOverlayProps = {
  visible: boolean;
  text?: string;
};

export default function LoadingOverlay({
  visible,
  text = "Cargando...",
}: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 px-4 backdrop-blur-[1px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex max-w-[90vw] items-center gap-3 rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-2xl">
        <span
          className="h-6 w-6 shrink-0 animate-spin rounded-full border-[3px] border-gray-200 border-t-red-700"
          aria-hidden="true"
        />

        <p className="text-sm font-semibold text-gray-900 sm:text-base">
          {text}
        </p>
      </div>
    </div>
  );
}
