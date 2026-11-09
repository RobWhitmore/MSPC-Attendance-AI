import React, { useState, useEffect } from "react";
import { getAdminIdentity, signIn, signOut, type AdminIdentity } from "./lib/api";
import {
  LogOut, Users, Calendar, 
  LayoutDashboard, Building2, FileText, Settings, 
  Wrench, Menu, X, PanelLeftClose, PanelLeft
} from "lucide-react";
import { AdminProvider, useAdmin } from "./context/AdminContext";

// Tabs
import { DashboardTab } from "./components/tabs/DashboardTab";
import { PeopleTab } from "./components/tabs/PeopleTab";
import { GroupsTab } from "./components/tabs/GroupsTab";
import { EventsTab } from "./components/tabs/EventsTab";
import { MaintenanceTab } from "./components/tabs/MaintenanceTab";
import { PersonDetailsModal } from "./components/PersonDetailsModal";

const TABS = [
  { name: 'Dashboard', icon: LayoutDashboard },
  { name: 'People', icon: Users },
  { name: 'Groups', icon: Building2 },
  { name: 'Events', icon: Calendar },
  { name: 'Reports', icon: FileText },
  { name: 'Settings', icon: Settings },
  { name: 'Maintenance', icon: Wrench },
];

function AdminApp({ email }: { email: string }) {
  const {
    activeTab,
    setActiveTab,
    refreshing,
    loadTabData,
    importGroupModal,
    setImportGroupModal,
    selectedPersonDetails,
    setSelectedPersonDetails,
    confirmDialog,
    setConfirmDialog,
    importResults,
    setImportResults,
    importLoading,
    processGroupCsvImport
  } = useAdmin();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "true");

  const toggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
        const newVal = !prev;
        localStorage.setItem("sidebarCollapsed", String(newVal));
        return newVal;
    });
  };

  useEffect(() => {
    loadTabData(activeTab);
  }, [activeTab, loadTabData]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'Dashboard':
        return <DashboardTab />;
      case 'People':
        return <PeopleTab />;
      case 'Groups':
        return <GroupsTab />;
      case 'Events':
        return <EventsTab />;
      case 'Maintenance':
        return <MaintenanceTab />;
      case 'Reports':
        return (
          <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm text-center max-w-xl mx-auto my-12 space-y-4">
            <div className="mx-auto w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center text-amber-600 mb-2">
              <FileText className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-stone-900">Reports Section</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              This section is currently under active development. In a future update, you'll be able to download custom PDF sheets and group metrics right here.
            </p>
          </div>
        );
      case 'Settings':
        return (
          <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm text-center max-w-xl mx-auto my-12 space-y-4">
            <div className="mx-auto w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center text-amber-600 mb-2">
              <Settings className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-stone-900">Settings Section</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              This panel is currently under construction. Future configuration toggles for organization emails, access permissions, and automated reminders will render here.
            </p>
          </div>
        );
      default:
        return (
          <div className="p-8 text-center text-stone-500 bg-white rounded-3xl border border-stone-200">
            <h2 className="text-2xl font-bold text-stone-900 mb-4">{activeTab}</h2>
            <p>This section is currently under construction.</p>
          </div>
        );
    }
  };

  return (
    <div className="h-screen flex overflow-hidden bg-stone-100 font-sans">
      {/* Desktop Sidebar */}
      <div className={`hidden md:flex flex-col bg-white border-r border-stone-200 transition-all duration-300 relative ${isSidebarCollapsed ? 'w-20' : 'w-64'}`}>
        <div className={`flex items-center gap-2 px-6 py-5 border-b border-stone-100 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
          <img src="/logo.png" alt="Logo" className="w-8 h-8 object-contain shrink-0" />
          {!isSidebarCollapsed && <h1 className="font-semibold text-lg text-stone-900 truncate">MSPC Admin</h1>}
        </div>
        
        <button 
          onClick={toggleSidebar}
          className="absolute -right-3 top-20 bg-white border border-stone-200 rounded-full p-1 text-stone-400 hover:text-stone-900 shadow-sm z-10 transition-colors outline-none"
          title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isSidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.name;
            return (
              <button
                key={tab.name}
                onClick={() => setActiveTab(tab.name)}
                title={isSidebarCollapsed ? tab.name : ''}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl font-semibold text-sm transition outline-none ${
                  isSidebarCollapsed ? 'justify-center' : ''
                } ${
                  isSelected 
                    ? "bg-amber-50 text-stone-900" 
                    : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${isSelected ? "text-stone-800" : "text-stone-400"}`} />
                {!isSidebarCollapsed && <span className="truncate">{tab.name}</span>}
              </button>
            )
          })}
        </div>

        <div className="p-4 border-t border-stone-100">
          <div className={`flex items-center justify-between ${isSidebarCollapsed ? 'flex-col gap-4' : ''}`}>
            {!isSidebarCollapsed && (
              <div className="truncate pr-2">
                <p className="text-sm font-semibold text-stone-900 truncate">{email}</p>
                <p className="text-xs text-stone-500 font-medium">Administrator</p>
              </div>
            )}
            <button 
              onClick={() => signOut()} 
              title="Sign Out"
              className="p-2 text-stone-400 hover:text-rose-600 transition rounded-2xl hover:bg-stone-50 shrink-0 outline-none"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Header + Sidebar Toggle */}
      <div className="flex flex-col flex-1 w-0 overflow-hidden">
        <div className="md:hidden pt-1 pl-1 sm:pl-3 sm:pt-3 bg-white border-b border-stone-200 flex justify-between items-center p-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Logo" className="w-6 h-6 object-contain" />
            <h1 className="font-semibold text-lg text-stone-900">MSPC Admin</h1>
          </div>
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="-mr-3 h-12 w-12 inline-flex items-center justify-center rounded-md text-stone-500 hover:text-stone-900 outline-none"
          >
            <Menu className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {/* Mobile Sidebar Overlay */}
        {isSidebarOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="fixed inset-0 bg-stone-600 bg-opacity-75" onClick={() => setIsSidebarOpen(false)} />
            <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white border-r border-stone-200">
              <div className="absolute top-0 right-0 -mr-12 pt-2">
                <button
                  className="ml-1 flex items-center justify-center h-10 w-10 border-2 border-transparent rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white outline-none"
                  onClick={() => setIsSidebarOpen(false)}
                >
                  <X className="h-6 w-6 text-white" aria-hidden="true" />
                </button>
              </div>
              <div className="flex-1 h-0 pt-5 pb-4 overflow-y-auto">
                <div className="flex-shrink-0 flex items-center px-4">
                  <img src="/logo.png" alt="Logo" className="w-8 h-8 object-contain" />
                  <h1 className="ml-2 font-semibold text-lg text-stone-900">MSPC Admin</h1>
                </div>
                <nav className="mt-5 px-2 space-y-1">
                  {TABS.map(tab => {
                    const Icon = tab.icon;
                    const isSelected = activeTab === tab.name;
                    return (
                      <button
                        key={tab.name}
                        onClick={() => { setActiveTab(tab.name); setIsSidebarOpen(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-2xl font-semibold text-base transition outline-none ${
                          isSelected 
                            ? "bg-amber-50 text-stone-900" 
                            : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                        }`}
                      >
                        <Icon className={`w-5 h-5 ${isSelected ? "text-stone-800" : "text-stone-400"}`} />
                        {tab.name}
                      </button>
                    )
                  })}
                </nav>
              </div>
              <div className="flex-shrink-0 flex border-t border-stone-200 p-4">
                <button onClick={() => signOut()} className="flex-shrink-0 w-full group block text-left outline-none">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-stone-700 group-hover:text-stone-900">{email}</p>
                      <p className="text-xs font-semibold text-stone-500 group-hover:text-stone-700">Sign out</p>
                    </div>
                    <LogOut className="w-5 h-5 text-stone-400" />
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 relative flex flex-col focus:outline-none bg-stone-100 overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="py-6 px-4 sm:px-6 md:px-8 h-full">
              {renderTabContent()}
            </div>
          </div>
        </main>
      </div>

      {/* Global Modals from AdminContext */}
      {importGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 text-center border border-stone-200">
            <h3 className="text-xl font-bold text-stone-900 mb-2">Import Members to <br/><span className="text-amber-700">{importGroupModal.groupName}</span></h3>
            <p className="text-stone-500 mb-8 text-sm font-medium">How would you like to apply these members?</p>
            <div className="flex flex-col gap-3">
              <button 
                disabled={importLoading === "groupMembers"}
                onClick={() => processGroupCsvImport('update')}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-2xl transition disabled:opacity-50 shadow-sm"
              >
                {importLoading === "groupMembers" ? "Importing..." : "Update / Add (Keep Existing)"}
              </button>
              <button 
                disabled={importLoading === "groupMembers"}
                onClick={() => processGroupCsvImport('replace')}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3.5 rounded-2xl transition disabled:opacity-50 shadow-sm"
              >
                {importLoading === "groupMembers" ? "Importing..." : "Replace (Delete Existing)"}
              </button>
              <button 
                disabled={importLoading === "groupMembers"}
                onClick={() => setImportGroupModal(null)}
                className="w-full bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold py-3.5 rounded-2xl transition mt-2 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedPersonDetails && (
        <PersonDetailsModal onClose={() => setSelectedPersonDetails(null)} />
      )}

      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-6 border border-stone-200">
            <h2 className="text-xl font-bold text-stone-900 mb-4">{confirmDialog.title || "Confirm Action"}</h2>
            <p className="text-stone-600 whitespace-pre-wrap mb-6 text-sm leading-relaxed font-medium">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3 flex-wrap">
              {confirmDialog.cancelText !== 'NONE' && (
                <button 
                  onClick={confirmDialog.onCancel}
                  className="px-4 py-2 text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-2xl font-semibold transition text-sm outline-none"
                >
                  {confirmDialog.cancelText || "Cancel"}
                </button>
              )}
              {confirmDialog.onSecondary && (
                <button 
                  onClick={confirmDialog.onSecondary}
                  className={`px-4 py-2 text-white rounded-2xl font-semibold transition text-sm outline-none ${confirmDialog.secondaryClass || "bg-amber-600 hover:bg-amber-700"}`}
                >
                  {confirmDialog.secondaryText || "Secondary Action"}
                </button>
              )}
              <button 
                onClick={confirmDialog.onConfirm}
                className={`px-4 py-2 text-white rounded-2xl font-semibold transition text-sm outline-none ${confirmDialog.confirmClass || "bg-rose-600 hover:bg-rose-700"}`}
              >
                {confirmDialog.confirmText || "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {importResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-xl max-w-lg w-full p-6 flex flex-col max-h-[80vh] border border-stone-200">
            <h2 className="text-xl font-bold text-stone-900 mb-2">Import Report</h2>
            <div className="flex gap-4 mb-4">
              <div className="flex-1 bg-emerald-50 p-3 rounded-2xl border border-emerald-100">
                <p className="text-xs text-emerald-600 font-extrabold uppercase tracking-wider">Loaded</p>
                <p className="text-2xl font-bold text-emerald-700">{importResults.successCount}</p>
              </div>
              <div className="flex-1 bg-rose-50 p-3 rounded-2xl border border-rose-100">
                <p className="text-xs text-rose-600 font-extrabold uppercase tracking-wider">Mismatches</p>
                <p className="text-2xl font-bold text-rose-700">{importResults.mismatchCount}</p>
              </div>
            </div>
            
            {importResults.logs.length > 0 && (
              <div className="flex-1 overflow-y-auto mb-6 bg-stone-50 rounded-2xl p-4 border border-stone-200">
                <h3 className="text-sm font-bold text-stone-700 mb-2">Error Logs:</h3>
                <ul className="space-y-1">
                  {importResults.logs.map((log, i) => (
                    <li key={i} className="text-xs text-rose-600 flex gap-2 font-medium">
                      <span className="shrink-0">•</span>
                      <span>{log}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end">
              <button 
                onClick={() => setImportResults(null)}
                className="px-6 py-2 bg-stone-800 text-white rounded-2xl font-bold hover:bg-stone-900 transition shadow-sm outline-none"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Why the API refused, said in words a person can act on. */
function explainRefusal(identity: AdminIdentity): string {
  switch (identity.reason) {
    case "domain-not-allowed":
      return `You signed in as ${identity.email}, which is not an MSPC address. Sign out and use your @mspc.org.nz account.`;
    case "no-admin-record":
      return `Your account (${identity.email}) is not registered as an administrator. Please contact your system director for access.`;
    case "no-email-claim":
      return "You are signed in, but Microsoft did not send an email address for your account. Contact your system director.";
    default:
      return "You are not signed in.";
  }
}

export default function App() {
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminIdentity()
      .then(result => { if (!cancelled) setIdentity(result); })
      .catch(err => {
        // A failure here is the API being unreachable, not a refusal. Saying so
        // is the difference between a five-minute check and an afternoon of
        // auditing a working deployment as a broken one.
        if (!cancelled) setLoadFailed(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, []);

  if (loadFailed) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-stone-100 p-4">
        <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-xl max-w-md w-full text-center space-y-4">
          <h2 className="text-xl font-bold text-stone-900">Could not reach the API</h2>
          <p className="text-stone-500 text-sm leading-relaxed">
            The application loaded but the server did not answer. This is a deployment
            or configuration problem, not a sign-in problem.
          </p>
          <p className="text-xs font-mono bg-stone-50 border border-stone-200 rounded-xl p-3 text-stone-600 break-words">
            {loadFailed}
          </p>
        </div>
      </div>
    );
  }

  if (!identity) {
    return (
      <div className="h-screen w-screen flex flex-col gap-4 items-center justify-center bg-stone-50">
        <div className="w-10 h-10 border-4 border-amber-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-stone-500 font-medium text-sm">Verifying authorization...</p>
      </div>
    );
  }

  if (!identity.isAdmin) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-stone-100 p-4">
        <div className="bg-white p-8 md:p-10 rounded-3xl border border-stone-200 shadow-xl max-w-md w-full text-center space-y-6">
          <img src="/logo.png" alt="Logo" className="w-16 h-16 object-contain mx-auto" />
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-stone-900">MSPC Administration</h2>
            <p className="text-stone-500 text-sm leading-relaxed">
              Sign in with your MSPC work account to manage people, roster schedules,
              group attendance, and system archives.
            </p>
          </div>

          {!identity.signedIn ? (
            <button
              onClick={signIn}
              className="w-full bg-stone-900 text-white py-3 px-4 rounded-2xl font-bold hover:bg-stone-800 active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-md"
            >
              <svg className="w-5 h-5" viewBox="0 0 23 23" aria-hidden="true">
                <path fill="#f35325" d="M1 1h10v10H1z" />
                <path fill="#81bc06" d="M12 1h10v10H12z" />
                <path fill="#05a6f0" d="M1 12h10v10H1z" />
                <path fill="#ffba08" d="M12 12h10v10H12z" />
              </svg>
              Sign in with Microsoft
            </button>
          ) : (
            <button
              onClick={signOut}
              className="w-full bg-white text-stone-700 border border-stone-200 py-3 px-4 rounded-2xl font-bold hover:bg-stone-50 active:scale-[0.98] transition-all shadow-sm"
            >
              Sign out
            </button>
          )}

          {identity.signedIn && (
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-semibold text-center">
              {explainRefusal(identity)}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <AdminProvider>
      <AdminApp email={identity.email ?? ""} />
    </AdminProvider>
  );
}
