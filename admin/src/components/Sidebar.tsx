import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  LayoutDashboard,
  Users,
  FileCheck,
  Gift,
  CreditCard,
  History,
  Settings,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { AdminApiClient } from '../lib/api';

interface SidebarProps {
  pendingBillsCount?: number;
}

export default function Sidebar({ pendingBillsCount = 0 }: SidebarProps) {
  const router = useRouter();

  const navItems = [
    { label: 'Dashboard', href: '/', icon: LayoutDashboard },
    { label: 'Plumbers & Tiles', href: '/users', icon: Users },
    {
      label: 'Bills Verification',
      href: '/bills',
      icon: FileCheck,
      badge: pendingBillsCount > 0 ? pendingBillsCount : null,
    },
    { label: 'Rewards & Pool', href: '/rewards', icon: Gift },
    { label: 'Payouts', href: '/payouts', icon: CreditCard },
    { label: 'Audit Logs', href: '/audit-logs', icon: History },
    { label: 'Settings', href: '/settings', icon: Settings },
  ];

  const handleLogout = () => {
    AdminApiClient.clearToken();
    router.push('/login');
  };

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col h-screen fixed left-0 top-0 z-30 select-none">
      {/* Brand Logo & Title */}
      <div className="p-5 border-b border-slate-100 flex items-center space-x-3">
        <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center text-white font-black text-xl shadow-md shadow-red-200">
          H
        </div>
        <div>
          <div className="font-extrabold text-slate-900 text-sm tracking-tight leading-tight">
            HIRALAL & SONS
          </div>
          <div className="text-[11px] font-semibold text-red-600 tracking-wider uppercase">
            Rewards Admin
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = router.pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-150 ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center space-x-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span
                  className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                    isActive ? 'bg-white text-blue-600' : 'bg-red-100 text-red-700 animate-pulse'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer Profile & Logout */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-700 font-bold text-sm">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800">Super Admin</div>
              <div className="text-[11px] text-slate-500">Master Access</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign Out"
            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
