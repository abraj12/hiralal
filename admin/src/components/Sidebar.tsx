import React, { useState, useEffect } from 'react';
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
  KeyRound,
  ShieldCheck,
  Bell,
  Menu,
  X,
} from 'lucide-react';
import { AdminApiClient } from '../lib/api';
import { filterNavItemsByRole } from '../lib/nav-utils';

interface SidebarProps {
  pendingBillsCount?: number;
  pendingPayoutsCount?: number;
}

export default function Sidebar({ pendingBillsCount = 0, pendingPayoutsCount = 0 }: SidebarProps) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setUser(AdminApiClient.getUser());
  }, []);

  // Auto-close mobile drawer when route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [router.asPath]);

  const role = user?.role; // 'BILL_ADMIN' | 'OPERATIONS_ADMIN'

  // Dynamic role-based navigation filtering:
  // BILL_ADMIN: Reviews & approves bills, views dashboard
  // OPERATIONS_ADMIN: Manages payouts, reward rules, GST, settings, user directory
  const allNavItems = [
    {
      label: 'Dashboard',
      href: '/',
      icon: LayoutDashboard,
      roles: ['BILL_ADMIN', 'OPERATIONS_ADMIN'],
    },
    {
      label: 'Plumbers & Tiles',
      href: '/users',
      icon: Users,
      roles: ['OPERATIONS_ADMIN'],
    },
    {
      label: 'Bills Verification',
      href: '/bills',
      icon: FileCheck,
      badge: pendingBillsCount > 0 ? pendingBillsCount : null,
      roles: ['BILL_ADMIN', 'OPERATIONS_ADMIN'],
    },
    {
      label: 'Reward Analytics',
      href: '/rewards',
      icon: Gift,
      roles: ['OPERATIONS_ADMIN'],
    },
    {
      label: 'Payouts',
      href: '/payouts',
      icon: CreditCard,
      badge: pendingPayoutsCount > 0 ? pendingPayoutsCount : null,
      roles: ['OPERATIONS_ADMIN'],
    },
    {
      label: 'Audit Logs',
      href: '/audit-logs',
      icon: History,
      roles: ['OPERATIONS_ADMIN'],
    },
    {
      label: 'Notifications',
      href: '/notifications',
      icon: Bell,
      roles: ['OPERATIONS_ADMIN'],
    },
    {
      label: 'Settings',
      href: '/settings',
      icon: Settings,
      roles: ['OPERATIONS_ADMIN'],
    },
  ];

  const navItems = filterNavItemsByRole(allNavItems, role);

  const handleLogout = async () => {
    await AdminApiClient.logout();
    router.push('/login');
  };

  const getRoleLabel = () => {
    if (role === 'BILL_ADMIN') return 'Bill Review Admin';
    if (role === 'OPERATIONS_ADMIN') return 'Operations Admin';
    return 'Administrator';
  };

  return (
    <>
      {/* Mobile Top Header (< lg) */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 z-40 flex items-center justify-between px-4 shadow-sm select-none">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
            aria-label="Toggle navigation menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center space-x-2.5">
            <img src="/assets/brand_logo.png" alt="Hiralal & Sons" className="w-8 h-8 object-contain flex-shrink-0" />
            <div>
              <div className="font-extrabold text-slate-900 text-xs tracking-tight leading-none">
                HIRALAL & SONS
              </div>
              <div className="text-[10px] font-semibold text-red-600 tracking-wider uppercase mt-0.5">
                {role === 'BILL_ADMIN' ? 'Bill Review' : role === 'OPERATIONS_ADMIN' ? 'Operations' : 'Admin'}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            {getRoleLabel()}
          </span>
          <button
            onClick={handleLogout}
            title="Sign Out"
            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Mobile Backdrop Overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Navigation Sidebar (Desktop fixed + Mobile slide-over drawer) */}
      <aside
        className={`fixed top-0 left-0 h-screen w-64 bg-white border-r border-slate-200 flex flex-col z-50 select-none transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        {/* Brand Logo & Title */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src="/assets/brand_logo.png" alt="Hiralal & Sons" className="w-10 h-10 object-contain flex-shrink-0" />
            <div>
              <div className="font-extrabold text-slate-900 text-sm tracking-tight leading-tight">
                HIRALAL & SONS
              </div>
              <div className="text-[11px] font-semibold text-red-600 tracking-wider uppercase">
                {role === 'BILL_ADMIN' ? 'Bill Review Portal' : role === 'OPERATIONS_ADMIN' ? 'Operations Portal' : 'Rewards Admin'}
              </div>
            </div>
          </div>
          {/* Close button for mobile drawer */}
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
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
                onClick={() => setMobileOpen(false)}
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
                <div className="text-xs font-bold text-slate-800">
                  {user?.fullName || getRoleLabel()}
                </div>
                <div className="text-[11px] text-slate-500 font-medium">
                  {getRoleLabel()}
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <Link
                href="/change-password"
                title="Change Password"
                className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
              >
                <KeyRound className="w-4 h-4" />
              </Link>
              <button
                onClick={handleLogout}
                title="Sign Out"
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
