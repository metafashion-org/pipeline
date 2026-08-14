import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function UnauthorizedPage() {
    return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <Card className="w-[350px]">
                <CardHeader>
                    <CardTitle className="text-destructive">Unauthorized</CardTitle>
                    <CardDescription>
                        Your email is not authorized to access this system.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                        Please contact the administrator if you believe this is an error.
                    </p>
                    <Button asChild variant="outline" className="w-full">
                        <Link href="/login">Return to Login</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
