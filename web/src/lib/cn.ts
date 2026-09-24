import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** clsx for conditionals, tailwind-merge so a caller's class can override a default. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
