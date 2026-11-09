import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { Person, AppEvent, Group, GroupType, Roster, GroupMember } from '../types';
import { api, apiJson, ApiError } from '../lib/api';
import { applyOptimisticRosterUpdate } from "../lib/rosterUtils";
import Papa from "papaparse";

interface AdminContextProps {
  loading: boolean;
  refreshing: boolean;
  people: Person[];
  events: AppEvent[];
  groups: Group[];
  groupTypes: GroupType[];
  rosters: Roster[];
  groupMembers: GroupMember[];
  loadTabData: (tab: string) => Promise<void>;
  setPeople: React.Dispatch<React.SetStateAction<Person[]>>;
  setEvents: React.Dispatch<React.SetStateAction<AppEvent[]>>;
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  setGroupTypes: React.Dispatch<React.SetStateAction<GroupType[]>>;
  setRosters: React.Dispatch<React.SetStateAction<Roster[]>>;
  setGroupMembers: React.Dispatch<React.SetStateAction<GroupMember[]>>;
  setRefreshing: React.Dispatch<React.SetStateAction<boolean>>;
  activeTab: string;
  setActiveTab: React.Dispatch<React.SetStateAction<string>>;

  // Shared Global Modals & Dialogs States
  importResults: { successCount: number; mismatchCount: number; logs: string[] } | null;
  setImportResults: React.Dispatch<React.SetStateAction<{ successCount: number; mismatchCount: number; logs: string[] } | null>>;

  importGroupModal: { groupId: string; groupName: string; file: File | null } | null;
  setImportGroupModal: React.Dispatch<React.SetStateAction<{ groupId: string; groupName: string; file: File | null } | null>>;

  selectedPersonDetails: Person | null;
  setSelectedPersonDetails: React.Dispatch<React.SetStateAction<Person | null>>;

  confirmDialog: {
    isOpen: boolean;
    title?: string;
    message: string;
    confirmText?: string;
    confirmClass?: string;
    cancelText?: string;
    secondaryText?: string;
    secondaryClass?: string;
    onSecondary?: () => void;
    onConfirm: () => void;
    onCancel: () => void;
  };
  setConfirmDialog: React.Dispatch<React.SetStateAction<any>>;

  importLoading: string | null;
  setImportLoading: React.Dispatch<React.SetStateAction<string | null>>;

  isDeleting: string | null;
  setIsDeleting: React.Dispatch<React.SetStateAction<string | null>>;

  isBackingUp: boolean;
  setIsBackingUp: React.Dispatch<React.SetStateAction<boolean>>;

  isRestoring: boolean;
  setIsRestoring: React.Dispatch<React.SetStateAction<boolean>>;

  isGeneratingEvents: boolean;
  setIsGeneratingEvents: React.Dispatch<React.SetStateAction<boolean>>;

  pendingActions: Record<string, boolean>;
  setPendingActions: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;

  // Master Handlers
  reclassifyPersonIfNeeded: (personId: string, updatedGroupMembers?: { id?: string; personId: string; role: string }[], newGroupMemberRole?: string) => Promise<void>;
  handleDeleteAll: (collectionName: string, activeTab: string) => Promise<void>;
  handleSystemBackup: () => Promise<void>;
  executeRestoreFromFile: (file: File, exactMirror: boolean) => Promise<void>;
  handleGenerateEvents: () => Promise<void>;
  handleSampleExport: (collectionName: string) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>, collectionName: string, activeTab: string) => void;
  handleAdminAction: (eventId: string, targetPersonId: string, action: string, value: string) => Promise<void>;
  handleAdminSubmitRoster: (eventId: string) => Promise<void>;
  handleApproveNewMember: (personId: string) => Promise<void>;
  handleDeclineNewMember: (personId: string) => Promise<void>;
  updatePerson: (personId: string, updates: Partial<Person>) => Promise<void>;
  handleExportToInfoodle: (event: any, activeTab?: string) => void;
  processGroupCsvImport: (mode: 'replace' | 'update') => Promise<void>;
  handleGroupCsvSelect: (e: React.ChangeEvent<HTMLInputElement>, groupId: string, groupName: string) => void;

  // Group membership, previously written to Firestore straight from GroupsTab
  addGroupMember: (groupId: string, personId: string, role: string) => Promise<GroupMember | null>;
  updateGroupMemberRole: (groupMemberId: string, role: string) => Promise<void>;
  removeGroupMember: (groupMemberId: string) => Promise<void>;
}

const AdminContext = createContext<AdminContextProps | undefined>(undefined);

/** Turn any failure into the server's own sentence where there is one. */
function describe(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export const AdminProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [loading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [people, setPeople] = useState<Person[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupTypes, setGroupTypes] = useState<GroupType[]>([]);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);

  // Shared Global Modals & Dialogs States
  const [importResults, setImportResults] = useState<{ successCount: number; mismatchCount: number; logs: string[] } | null>(null);
  const [importGroupModal, setImportGroupModal] = useState<{ groupId: string; groupName: string; file: File | null } | null>(null);
  const [selectedPersonDetails, setSelectedPersonDetails] = useState<Person | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<any>({
    isOpen: false,
    message: "",
    onConfirm: () => {},
    onCancel: () => {}
  });
  const [importLoading, setImportLoading] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isGeneratingEvents, setIsGeneratingEvents] = useState(false);
  const [pendingActions, setPendingActions] = useState<Record<string, boolean>>({});

  const closeDialog = useCallback(() => {
    setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }));
  }, []);

  const showMessage = useCallback((title: string, message: string, tone: 'ok' | 'error' = 'ok') => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      confirmText: "OK",
      confirmClass: tone === 'error' ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700",
      cancelText: "NONE",
      onConfirm: closeDialog,
      onCancel: closeDialog
    });
  }, [closeDialog]);

  /**
   * One request per tab. The Firebase version made up to six parallel Firestore
   * queries from the browser; the server now decides what a tab needs.
   */
  const loadTabData = useCallback(async (tab: string) => {
    setRefreshing(true);
    try {
      const data = await api<Record<string, any[]>>(`/api/admin/data/${encodeURIComponent(tab)}`);
      if (data.people) setPeople(data.people as Person[]);
      if (data.events) setEvents(data.events as AppEvent[]);
      if (data.groups) setGroups(data.groups as Group[]);
      if (data.groupTypes) setGroupTypes(data.groupTypes as GroupType[]);
      if (data.rosters) setRosters(data.rosters as Roster[]);
      if (data.groupMembers) setGroupMembers(data.groupMembers as GroupMember[]);
    } catch (e) {
      console.error("Failed to load tab data:", describe(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  /**
   * Ask the server to re-derive this person's type.
   *
   * The classification rules and the data they need both live server-side now,
   * so the caller no longer has to pass the whole membership list in.
   */
  const reclassifyPersonIfNeeded = useCallback(async (
    personId: string,
    _updatedGroupMembers?: { id?: string; personId: string; role: string }[],
    newGroupMemberRole?: string
  ) => {
    try {
      const result = await apiJson<{ changed: boolean; type: string; qualifies: boolean }>(
        `/api/admin/people/${encodeURIComponent(personId)}/reclassify`,
        "POST",
        { newGroupMemberRole }
      );
      if (result.changed) {
        setPeople(prev => prev.map(p =>
          p.id === personId ? { ...p, type: result.type, qualifies: result.qualifies } : p
        ));
      }
    } catch (err) {
      console.error("Error auto-reclassifying person type:", describe(err));
    }
  }, []);

  const handleDeleteAll = useCallback(async (collectionName: string, activeTabArg: string) => {
    setIsDeleting(collectionName);
    try {
      // The counts come from the database rather than from whatever the browser
      // happens to be holding, so the warning states facts.
      const preview = await api<{ count: number; dependents: Record<string, number> }>(
        `/api/admin/collections/${encodeURIComponent(collectionName)}/delete-all-preview`
      );

      if (preview.count === 0) {
        console.log(`No documents found in ${collectionName}.`);
        setIsDeleting(null);
        return;
      }

      const depMessages = Object.entries(preview.dependents)
        .filter(([, n]) => n > 0)
        .map(([name, n]) => `${n} records in ${name}`);

      let confirmMsg = `Are you SURE you want to delete all ${preview.count} records in ${collectionName}?`;
      if (depMessages.length > 0) {
        confirmMsg += `\n\nThis will also delete:\n- ` + depMessages.join('\n- ');
      }
      confirmMsg += `\n\nThis cannot be undone.`;

      setConfirmDialog({
        isOpen: true,
        message: confirmMsg,
        onConfirm: async () => {
          closeDialog();
          try {
            const result = await apiJson<{ deleted: Record<string, number> }>(
              `/api/admin/collections/${encodeURIComponent(collectionName)}/delete-all`,
              "POST",
              { confirm: true }
            );
            const total = Object.values(result.deleted).reduce((a, b) => a + b, 0);
            console.log(`Successfully deleted ${total} records across all affected collections.`);
            loadTabData(activeTabArg);
          } catch (e) {
            showMessage("Delete Failed", describe(e), 'error');
          } finally {
            setIsDeleting(null);
          }
        },
        onCancel: () => {
          closeDialog();
          setIsDeleting(null);
        }
      });
    } catch (e) {
      showMessage("Delete Failed", describe(e), 'error');
      setIsDeleting(null);
    }
  }, [loadTabData, closeDialog, showMessage]);

  const handleSystemBackup = useCallback(async () => {
    setIsBackingUp(true);
    try {
      const backupData = await api<Record<string, any[]>>("/api/admin/backup");

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `system-backup-${timestamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showMessage("Backup Failed", "Failed to create system backup.\n\nError: " + describe(e), 'error');
    } finally {
      setIsBackingUp(false);
    }
  }, [showMessage]);

  const executeRestoreFromFile = useCallback(async (file: File, exactMirror: boolean) => {
    setIsRestoring(true);
    try {
      const backup = JSON.parse(await file.text());
      await apiJson("/api/admin/restore", "POST", { backup, exactMirror });

      showMessage(
        "Restore Complete",
        exactMirror
          ? "System restored and synchronized exactly (missing database rows deleted)!"
          : "System restored (merged) successfully!"
      );
      loadTabData('Maintenance');
    } catch (err) {
      showMessage(
        "Restore Failed",
        "Failed to restore backup. Ensure the file is a valid JSON backup format.\n\nError: " + describe(err),
        'error'
      );
    } finally {
      setIsRestoring(false);
    }
  }, [loadTabData, showMessage]);

  const handleGenerateEvents = useCallback(async () => {
    setIsGeneratingEvents(true);
    try {
      const { createdCount } = await apiJson<{ createdCount: number }>(
        "/api/admin/generate-events", "POST", {}
      );
      alert(`Event generation complete! ${createdCount} new events created for the next 35 days.`);
      loadTabData('Dashboard');
    } catch (err) {
      console.error("Failed to generate events:", describe(err));
      alert("An error occurred while generating events: " + describe(err));
    } finally {
      setIsGeneratingEvents(false);
    }
  }, [loadTabData]);

  const handleSampleExport = useCallback((collectionName: string) => {
    let fields: string[] = [];
    if (collectionName === "people") {
      // "qualifies" rather than "condition": the template should not invite
      // anyone to type a diagnosis into a spreadsheet that then gets emailed
      // around. A "condition" column is refused on import, with a warning.
      // MS vs PD is carried by group membership - see INFOODLE-CSV.md.
      // Two Infoodle id columns, because Infoodle issues two different numbers
      // for a person: "infoodleUniqueId" is what a CSV export gives you,
      // "infoodleId" is the one attendance write-back needs. See INFOODLE-CSV.md.
      fields = ["infoodleId", "infoodleUniqueId", "firstName", "lastName", "email", "type", "qualifies", "supportPersonName"];
    } else if (collectionName === "events") {
      fields = ["infoodleId", "groupName", "title", "date", "time", "duration", "status", "notes"];
    } else if (collectionName === "rosters") {
      fields = ["personName", "eventTitle", "eventDate", "role", "rsvpStatus", "attendanceStatus"];
    } else if (collectionName === "groups") {
      fields = ["shortValue", "name", "dateRule", "timeRule", "scheduleText", "skipHolidays", "who", "locationName", "locationLink"];
    } else if (collectionName === "groupMembers") {
      fields = ["groupId", "groupName", "personId", "fullName", "role"];
    } else if (collectionName === "groupTypes") {
      fields = ["shortValue", "longValue"];
    }

    const csvContent = "data:text/csv;charset=utf-8," + fields.join(",");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `sample_${collectionName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  /**
   * Parse the CSV here, resolve and write it there.
   *
   * The name-to-id resolution used to run in the browser against a full copy of
   * every person, group and event. The server does it now, which is why this
   * function has become a file read and one request.
   */
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>, collectionName: string, activeTabArg: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(collectionName);
    setImportResults(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const result = await apiJson<{ successCount: number; mismatchCount: number; logs: string[] }>(
            `/api/admin/import/${encodeURIComponent(collectionName)}`,
            "POST",
            { rows: results.data }
          );
          setImportResults(result);
          loadTabData(activeTabArg);
        } catch (err) {
          setImportResults({ successCount: 0, mismatchCount: 0, logs: [`Import failed: ${describe(err)}`] });
        } finally {
          setImportLoading(null);
        }
      },
      error: (error) => {
        setImportResults({ successCount: 0, mismatchCount: 0, logs: [`Failed to parse CSV: ${error.message}`] });
        setImportLoading(null);
      }
    });
  }, [loadTabData]);

  const handleAdminAction = useCallback(async (eventId: string, targetPersonId: string, action: string, value: string) => {
    const actionKey = `${eventId}-${targetPersonId}`;
    if (pendingActions[actionKey]) return;
    setPendingActions(prev => ({ ...prev, [actionKey]: true }));

    const previousRosters = [...rosters];
    setRosters(prev => applyOptimisticRosterUpdate(prev, eventId, targetPersonId, action, value));

    try {
      await apiJson("/api/admin/action", "POST", { eventId, targetPersonId, action, value });
    } catch (e) {
      console.error("Failed to update roster:", describe(e));
      setRosters(previousRosters);
    } finally {
      setPendingActions(prev => {
        const updated = { ...prev };
        delete updated[actionKey];
        return updated;
      });
    }
  }, [rosters, pendingActions]);

  const handleAdminSubmitRoster = useCallback(async (eventId: string) => {
    try {
      await apiJson("/api/admin/submit-attendance", "POST", { eventId });
      setEvents(prev => prev.map(ev => ev.id === eventId ? { ...ev, status: 'submitted', rosterStatus: 'submitted' } as AppEvent : ev));
    } catch (err) {
      alert(`Error submitting roster: ${describe(err)}`);
    }
  }, []);

  const handleApproveNewMember = useCallback(async (personId: string) => {
    try {
      const { type } = await apiJson<{ type: string }>(
        `/api/admin/people/${encodeURIComponent(personId)}/approve`, "POST", {}
      );
      setPeople(prev => prev.map(p => p.id === personId ? { ...p, type } : p));
      setSelectedPersonDetails(prev => prev && prev.id === personId ? { ...prev, type } : prev);
    } catch (err) {
      console.error("Failed to approve member:", describe(err));
    }
  }, []);

  const handleDeclineNewMember = useCallback(async (personId: string) => {
    try {
      // The server removes the memberships and rosters too - the browser used
      // to do that itself from whatever it happened to have loaded, which meant
      // rows outside the current view survived.
      await api(`/api/admin/people/${encodeURIComponent(personId)}`, { method: "DELETE" });

      setPeople(prev => prev.filter(p => p.id !== personId));
      setGroupMembers(prev => prev.filter(gm => gm.personId !== personId));
      setRosters(prev => prev.filter(r => r.personId !== personId));
      if (selectedPersonDetails?.id === personId) setSelectedPersonDetails(null);
    } catch (err) {
      console.error("Failed to decline member:", describe(err));
    }
  }, [selectedPersonDetails]);

  const updatePerson = useCallback(async (personId: string, updates: Partial<Person>) => {
    try {
      await apiJson(`/api/admin/people/${encodeURIComponent(personId)}`, "PATCH", updates);
      setPeople(prev => prev.map(p => p.id === personId ? { ...p, ...updates } : p));
      setSelectedPersonDetails(prev => prev?.id === personId ? { ...prev, ...updates } : prev);
    } catch (err) {
      alert(`Failed to update person: ${describe(err)}`);
      throw err;
    }
  }, []);

  const handleExportToInfoodle = useCallback((event: any, activeTabArg?: string) => {
    const tabToReload = activeTabArg || activeTab;
    setConfirmDialog({
      isOpen: true,
      title: "Confirm Export",
      confirmText: "Export",
      confirmClass: "bg-emerald-600 hover:bg-emerald-700",
      message: `Export roster for "${event.title}" on ${event.date} to Infoodle? This will set the status to "Exported".`,
      onCancel: closeDialog,
      onConfirm: async () => {
        closeDialog();
        try {
          await apiJson("/api/admin/export-event", "POST", { eventId: event.id });

          const eventRosters = rosters.filter(r => {
            if (r.eventId !== event.id) return false;
            const rsvp = String(r.rsvpStatus).toLowerCase();
            const att = String(r.attendanceStatus).toLowerCase();
            return rsvp === 'cancelled' || att === 'present' || att === 'no-show';
          });

          const exportData = eventRosters.map(r => {
            const person = people.find(p => p.id === r.personId);
            const gm = groupMembers.find(g => g.personId === r.personId && g.groupId === event.groupId);
            const group = groups.find(g => g.id === event.groupId);

            let cancelledDate = "";
            if (String(r.rsvpStatus).toLowerCase() === 'cancelled' && r.updatedAt) {
              try {
                const dStr = String(r.updatedAt);
                cancelledDate = dStr.split('T')[0] + ' ' + dStr.split('T')[1].substring(0, 5);
              } catch { /* a timestamp we cannot split is left blank */ }
            }

            return {
              "Group Name": group?.name || "",
              "Event Infoodle Id": event.infoodleId || "",
              "Event Name": event.title || "",
              "Person Infoodle Id": person?.infoodleId || "",
              "Person Name": `${person?.firstName || ""} ${person?.lastName || ""}`.trim(),
              "Person type": person?.type || "",
              "Group Member Role": gm?.role || "",
              "Note": r.note || "",
              "RSVP": r.rsvpStatus || "none",
              "Attendance": r.attendanceStatus || "none",
              "Cancelled DateTime": cancelledDate
            };
          });

          const csv = Papa.unparse(exportData);
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const link = document.createElement("a");
          const url = URL.createObjectURL(blob);
          link.setAttribute("href", url);
          link.setAttribute("download", `infoodle_export_${String(event.title).replace(/\s+/g, '_')}_${event.date}.csv`);
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);

          loadTabData(tabToReload);
        } catch (e) {
          console.error("An error occurred during export:", describe(e));
          showMessage("Export Failed", describe(e), 'error');
        }
      }
    });
  }, [rosters, people, groupMembers, groups, loadTabData, activeTab, closeDialog, showMessage]);

  const processGroupCsvImport = useCallback(async (mode: 'replace' | 'update') => {
    if (!importGroupModal?.file) return;
    setImportLoading("groupMembers");

    Papa.parse(importGroupModal.file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          await apiJson("/api/admin/import-group-members", "POST", {
            groupId: importGroupModal.groupId,
            mode,
            rows: results.data
          });

          alert(`Import successful! Added/updated members for ${importGroupModal.groupName}.`);
          setImportGroupModal(null);
          loadTabData("Groups");
        } catch (err) {
          alert("Import failed: " + describe(err));
        } finally {
          setImportLoading(null);
        }
      },
      error: (error) => {
        alert("Failed to parse CSV: " + error.message);
        setImportLoading(null);
      }
    });
  }, [importGroupModal, loadTabData]);

  const handleGroupCsvSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>, groupId: string, groupName: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportGroupModal({ groupId, groupName, file });
    e.target.value = '';
  }, []);

  const addGroupMember = useCallback(async (groupId: string, personId: string, role: string) => {
    try {
      const { groupMember } = await apiJson<{ groupMember: GroupMember }>(
        "/api/admin/group-members", "POST", { groupId, personId, role }
      );
      setGroupMembers(prev => [...prev, groupMember]);
      return groupMember;
    } catch (err) {
      alert(`Failed to add group member: ${describe(err)}`);
      return null;
    }
  }, []);

  const updateGroupMemberRole = useCallback(async (groupMemberId: string, role: string) => {
    try {
      await apiJson(`/api/admin/group-members/${encodeURIComponent(groupMemberId)}`, "PATCH", { role });
      setGroupMembers(prev => prev.map(gm => gm.id === groupMemberId ? { ...gm, role } : gm));
    } catch (err) {
      alert(`Failed to update role: ${describe(err)}`);
    }
  }, []);

  const removeGroupMember = useCallback(async (groupMemberId: string) => {
    try {
      await api(`/api/admin/group-members/${encodeURIComponent(groupMemberId)}`, { method: "DELETE" });
      setGroupMembers(prev => prev.filter(gm => gm.id !== groupMemberId));
    } catch (err) {
      alert(`Failed to remove group member: ${describe(err)}`);
    }
  }, []);

  return (
    <AdminContext.Provider value={{
      loading,
      refreshing,
      people,
      events,
      groups,
      groupTypes,
      rosters,
      groupMembers,
      loadTabData,
      setPeople,
      setEvents,
      setGroups,
      setGroupTypes,
      setRosters,
      setGroupMembers,
      setRefreshing,
      activeTab,
      setActiveTab,

      importResults,
      setImportResults,
      importGroupModal,
      setImportGroupModal,
      selectedPersonDetails,
      setSelectedPersonDetails,
      confirmDialog,
      setConfirmDialog,
      importLoading,
      setImportLoading,
      isDeleting,
      setIsDeleting,
      isBackingUp,
      setIsBackingUp,
      isRestoring,
      setIsRestoring,
      isGeneratingEvents,
      setIsGeneratingEvents,
      pendingActions,
      setPendingActions,

      reclassifyPersonIfNeeded,
      handleDeleteAll,
      handleSystemBackup,
      executeRestoreFromFile,
      handleGenerateEvents,
      handleSampleExport,
      handleFileUpload,
      handleAdminAction,
      handleAdminSubmitRoster,
      handleApproveNewMember,
      handleDeclineNewMember,
      updatePerson,
      handleExportToInfoodle,
      processGroupCsvImport,
      handleGroupCsvSelect,

      addGroupMember,
      updateGroupMemberRole,
      removeGroupMember
    }}>
      {children}
    </AdminContext.Provider>
  );
};

export const useAdmin = () => {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
};
