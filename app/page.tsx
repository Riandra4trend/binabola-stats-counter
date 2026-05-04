"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    const session = loadSession();
    if (session) {
      router.replace("/tracker");
    } else {
      router.replace("/setup");
    }
  }, []);

  return null;
}