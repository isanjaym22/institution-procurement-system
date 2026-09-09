import Image from "next/image";
import { SignOut } from "@phosphor-icons/react";
import type { User } from "@/lib/api";
import { roleLabel } from "@/lib/workflow";
import { Button } from "./ui/button";

export function SiteHeader({
  user,
  onLogout,
}: {
  user: User | null;
  onLogout?: () => void;
}) {
  return (
    <header className="bg-brand-900 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src="/favicon.png"
            alt="Institution logo"
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-lg bg-white p-0.5"
            priority
          />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold tracking-tight">
              Institution Procurement Management
            </p>
            <p className="text-xs text-brand-200">
              Requisitions · Approvals · Purchase · Billing
            </p>
          </div>
        </div>
        {user && (
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="text-right">
              <p className="text-sm font-medium text-white">{user.name}</p>
              <p className="text-xs text-brand-200">
                {roleLabel(user.role)}
                {user.designation ? ` · ${user.designation}` : ""}
                {user.employee_id ? ` · ${user.employee_id}` : ""}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={onLogout}
              className="border border-white/20 bg-white/10 text-white ring-0 hover:bg-white/20"
            >
              <SignOut size={15} aria-hidden="true" />
              Logout
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
