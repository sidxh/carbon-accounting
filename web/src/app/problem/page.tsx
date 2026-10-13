import type { Metadata } from "next";
import { ProblemStory } from "./problem-story";

export const metadata: Metadata = {
  title: "The problem · Supplier Carbon",
  description: "Why small suppliers in Asia are being asked for carbon data, what their customers need from them, and why today's tools miss them.",
};

export default function ProblemPage() {
  return <ProblemStory />;
}
