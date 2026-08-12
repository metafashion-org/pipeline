"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        setLoading(true);
        try {
            await signIn("google", { callbackUrl: "/admin" });
        } catch (error) {
            console.error(error);
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
            <Card className="w-[350px]">
                <CardHeader>
                    <CardTitle>Metafashion Tasks</CardTitle>
                    <CardDescription>Login to access the task management system.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                    <Button className="w-full" onClick={handleLogin} disabled={loading}>
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Login with Google
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
