"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={() => signOut({ callbackUrl: "/login" })}
            title="Log out"
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
        >
            <LogOut className="h-4 w-4" />
        </Button>
    );
}
