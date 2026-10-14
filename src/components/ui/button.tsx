"use client";
import type { ButtonHTMLAttributes, Ref } from "react";
import type { SoundName } from "@/lib/sound/engine";
import { useSound } from "../sound-provider";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "plain" | "primary" | "danger" | "ghost";
  size?: "md" | "sm";
  /** Sound on click; `null` for silent. Defaults to the soft click. */
  sound?: SoundName | null;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = "plain", size = "md", sound = "click", className = "", onClick, type = "button", ...rest }: Props) {
  const { play } = useSound();
  const cls = ["btn", variant !== "plain" && `btn-${variant}`, size === "sm" && "btn-sm", className].filter(Boolean).join(" ");
  return (
    <button
      type={type}
      className={cls}
      onClick={(e) => {
        if (sound) play(sound);
        onClick?.(e);
      }}
      {...rest}
    />
  );
}
