import { EditorialPage, paperCard } from "@/app/ui/shared/Editorial";

/** Route-level loading state for list pages whose data is prefilled on the server. */
export default function ListSkeleton({ width = "max-w-[860px]" }: { width?: string }) {
  return (
    <EditorialPage width={width}>
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
        <div className="mb-6 h-24 animate-pulse rounded-2xl bg-foreground/5" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={`${paperCard} h-14 animate-pulse opacity-60`} />
        ))}
      </div>
    </EditorialPage>
  );
}
