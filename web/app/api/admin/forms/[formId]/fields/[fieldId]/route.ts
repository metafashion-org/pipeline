import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { deleteFormField } from "@/lib/forms/form-engine";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ fieldId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fieldId } = await params;
  await deleteFormField(fieldId);
  return NextResponse.json({ success: true });
}
