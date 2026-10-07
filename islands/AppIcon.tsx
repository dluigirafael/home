import { useState } from "preact/hooks";

interface Props {
  slug: string;
}

export default function AppIcon({ slug }: Props) {
  const [stage, setStage] = useState<"svg" | "png" | "hidden">("svg");

  if (stage === "hidden") {
    return <span class="h-icon" aria-hidden="true" />;
  }

  const src = `https://media.sys.truenas.net/apps/${slug}/icons/icon.${stage}`;

  return (
    <img
      class="h-icon"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setStage(stage === "svg" ? "png" : "hidden")}
    />
  );
}