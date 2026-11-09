import React, { useState } from "react";
import { useAdmin } from "../../context/AdminContext";
import { Wrench, Download, Upload, Trash2 } from "lucide-react";

export const MaintenanceTab: React.FC = () => {
    const {
        people,
        events,
        rosters,
        groupTypes,
        groups,
        groupMembers,
        isBackingUp,
        isRestoring,
        importLoading,
        isDeleting,
        handleSystemBackup,
        executeRestoreFromFile,
        handleSampleExport,
        handleFileUpload,
        handleDeleteAll,
        setConfirmDialog
    } = useAdmin();

    const [showRestoreDetails, setShowRestoreDetails] = useState(false);

    const handleSystemRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset the input value so that the same file can be uploaded again if needed
        const inputElement = e.target;
        
        const confirmMsg = "How would you like to restore this backup?\n\n" +
            "• MERGE: Updates existing records and adds new ones. Existing records not in the backup are kept.\n" +
            "• REPLACE (Exact Mirror): Deletes any database records that are NOT present in your backup file.";

        setConfirmDialog({
            isOpen: true,
            title: "Restore from Backup",
            message: confirmMsg,
            confirmText: "Replace",
            confirmClass: "bg-rose-600 hover:bg-rose-700",
            secondaryText: "Merge",
            secondaryClass: "bg-blue-600 hover:bg-blue-700",
            onConfirm: () => {
                setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }));
                executeRestoreFromFile(file, true).finally(() => {
                    inputElement.value = '';
                });
            },
            onSecondary: () => {
                setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }));
                executeRestoreFromFile(file, false).finally(() => {
                    inputElement.value = '';
                });
            },
            onCancel: () => {
                setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }));
                inputElement.value = '';
            }
        });
    };

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-stone-900 flex items-center gap-2">
                <Wrench className="w-6 h-6 text-stone-500" /> Maintenance
            </h2>

            <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm space-y-6">
                <div>
                    <h3 className="text-lg font-bold text-stone-900 mb-2">System Backup</h3>
                    <p className="text-stone-500 text-sm mb-4">
                        Download a complete snapshot of all database collections as a JSON file.
                    </p>
                    <button
                        onClick={handleSystemBackup}
                        disabled={isBackingUp}
                        className="bg-stone-800 text-white px-4 py-2 rounded-2xl font-bold hover:bg-stone-900 transition flex items-center gap-2 disabled:opacity-50 inline-flex w-fit shadow-sm"
                    >
                        <Download className="w-4 h-4" />
                        {isBackingUp ? "Backing up..." : "System Backup"}
                    </button>
                </div>
                
                <div className="border-t border-stone-100 pt-6">
                    <h3 className="text-lg font-bold text-stone-900 mb-2">System Restore</h3>
                    <p className="text-stone-500 text-sm mb-2">
                        Restore a previously saved snapshot. This merges or mirrors the backup data into your existing database.
                    </p>
                    
                    <button 
                        onClick={() => setShowRestoreDetails(!showRestoreDetails)}
                        className="text-amber-600 hover:text-amber-700 text-sm font-bold flex items-center gap-1 mb-4 transition-colors"
                    >
                        {showRestoreDetails ? "Show less..." : "Show more..."}
                    </button>
                    
                    {showRestoreDetails && (
                        <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 mb-4 text-sm text-stone-600 space-y-3">
                            <p><strong className="text-stone-800">Adding Rows:</strong> To add a new record in your JSON backup, create a new object without an <code>"id"</code> field (or set <code>"id": ""</code>). When restored, the server generates a new unique ID for it.</p>
                            <p><strong className="text-stone-800">Editing Rows:</strong> Modify any field values inside existing JSON objects. Upon restore, the existing record matching that <code>"id"</code> will be updated.</p>
                            <p><strong className="text-stone-800">Deleting Rows:</strong> Remove the record object entirely from the JSON array. When uploading the backup, select <strong>OK (Exact Mirror)</strong> on the confirmation prompt to delete any database records that are missing from your JSON file.</p>
                            <p><strong className="text-stone-800">Merge Mode:</strong> If you select <strong>Cancel (Merge)</strong> on the confirmation prompt, existing database records not in your JSON file will remain untouched.</p>
                        </div>
                    )}

                    <label className="bg-stone-100 text-stone-800 px-4 py-2 rounded-2xl font-bold cursor-pointer hover:bg-stone-200 transition border border-stone-200 flex items-center gap-2 disabled:opacity-50 inline-flex w-fit">
                        <Upload className="w-4 h-4" />
                        {isRestoring ? "Restoring..." : "Restore from Backup"}
                        <input type="file" className="hidden" accept=".json" onChange={handleSystemRestore} disabled={isRestoring} />
                    </label>
                </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-stone-200 space-y-6 shadow-sm">
                <h3 className="text-lg font-medium border-b border-stone-100 pb-2">Table: People</h3>
                <div className="flex flex-wrap gap-4 items-center">
                    <button 
                        onClick={() => handleSampleExport("people")}
                        className="bg-stone-100 text-stone-700 px-4 py-2 rounded-2xl font-medium hover:bg-stone-200 transition border border-stone-200 flex items-center gap-2 text-sm shadow-sm"
                    >
                        <Download className="w-4 h-4" />
                        Sample Export
                    </button>
                    <label className="bg-amber-50 text-stone-800 px-4 py-2 rounded-2xl font-medium cursor-pointer hover:bg-amber-100 transition relative flex items-center gap-2 text-sm border border-amber-200 shadow-sm">
                        <Upload className="w-4 h-4" />
                        {importLoading === "people" ? "Importing..." : "Import CSV"}
                        <input type="file" className="hidden" accept=".csv" onChange={(e) => handleFileUpload(e, "people", "Maintenance")} disabled={importLoading !== null} />
                    </label>
                    
                    <button 
                        onClick={() => handleDeleteAll("people", "Maintenance")}
                        disabled={isDeleting === "people"}
                        className="bg-rose-50 text-rose-600 px-4 py-2 rounded-2xl font-medium hover:bg-rose-100 transition flex items-center gap-2 text-sm shadow-sm border border-rose-100"
                    >
                        <Trash2 className="w-4 h-4" />
                        {isDeleting === 'people' ? 'Deleting...' : `Delete All People (${people.length})`}
                    </button>
                </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-stone-200 space-y-6 shadow-sm">
                <h3 className="text-lg font-medium border-b border-stone-100 pb-2">Table: AppEvents</h3>
                <div className="flex flex-wrap gap-4 items-center">
                    <button 
                        onClick={() => handleSampleExport("events")}
                        className="bg-stone-100 text-stone-700 px-4 py-2 rounded-2xl font-medium hover:bg-stone-200 transition border border-stone-200 flex items-center gap-2 text-sm shadow-sm"
                    >
                        <Download className="w-4 h-4" />
                        Sample Export
                    </button>
                    <label className="bg-amber-50 text-stone-800 px-4 py-2 rounded-2xl font-medium cursor-pointer hover:bg-amber-100 transition relative flex items-center gap-2 text-sm border border-amber-200 shadow-sm">
                        <Upload className="w-4 h-4" />
                        {importLoading === "events" ? "Importing..." : "Import CSV"}
                        <input type="file" className="hidden" accept=".csv" onChange={(e) => handleFileUpload(e, "events", "Maintenance")} disabled={importLoading !== null} />
                    </label>
                    
                    <button 
                        onClick={() => handleDeleteAll("events", "Maintenance")}
                        disabled={isDeleting === "events"}
                        className="bg-rose-50 text-rose-600 px-4 py-2 rounded-2xl font-medium hover:bg-rose-100 transition flex items-center gap-2 text-sm shadow-sm border border-rose-100"
                    >
                        <Trash2 className="w-4 h-4" />
                        {isDeleting === 'events' ? 'Deleting...' : `Delete All Events (${events.length})`}
                    </button>
                </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-stone-200 space-y-6 shadow-sm">
                <h3 className="text-lg font-medium border-b border-stone-100 pb-2">Table: Rosters</h3>
                <div className="flex flex-wrap gap-4 items-center">
                    <button 
                        onClick={() => handleSampleExport("rosters")}
                        className="bg-stone-100 text-stone-700 px-4 py-2 rounded-2xl font-medium hover:bg-stone-200 transition border border-stone-200 flex items-center gap-2 text-sm shadow-sm"
                    >
                        <Download className="w-4 h-4" />
                        Sample Export
                    </button>
                    <label className="bg-amber-50 text-stone-800 px-4 py-2 rounded-2xl font-medium cursor-pointer hover:bg-amber-100 transition relative flex items-center gap-2 text-sm border border-amber-200 shadow-sm">
                        <Upload className="w-4 h-4" />
                        {importLoading === "rosters" ? "Importing..." : "Import CSV"}
                        <input type="file" className="hidden" accept=".csv" onChange={(e) => handleFileUpload(e, "rosters", "Maintenance")} disabled={importLoading !== null} />
                    </label>
                    
                    <button 
                        onClick={() => handleDeleteAll("rosters", "Maintenance")}
                        disabled={isDeleting === "rosters"}
                        className="bg-rose-50 text-rose-600 px-4 py-2 rounded-2xl font-medium hover:bg-rose-100 transition flex items-center gap-2 text-sm shadow-sm border border-rose-100"
                    >
                        <Trash2 className="w-4 h-4" />
                        {isDeleting === 'rosters' ? 'Deleting...' : `Delete All Rosters (${rosters.length})`}
                    </button>
                </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-stone-200 space-y-6 shadow-sm">
                <h3 className="text-lg font-medium border-b border-stone-100 pb-2">Table: Group Types</h3>
                <div className="flex flex-wrap gap-4 items-center">
                    <button 
                        onClick={() => handleSampleExport("groupTypes")}
                        className="bg-stone-100 text-stone-700 px-4 py-2 rounded-2xl font-medium hover:bg-stone-200 transition border border-stone-200 flex items-center gap-2 text-sm shadow-sm"
                    >
                        <Download className="w-4 h-4" />
                        Sample Export
                    </button>
                    <label className="bg-amber-50 text-stone-800 px-4 py-2 rounded-2xl font-medium cursor-pointer hover:bg-amber-100 transition relative flex items-center gap-2 text-sm border border-amber-200 shadow-sm">
                        <Upload className="w-4 h-4" />
                        {importLoading === "groupTypes" ? "Importing..." : "Import CSV"}
                        <input type="file" className="hidden" accept=".csv" onChange={(e) => handleFileUpload(e, "groupTypes", "Maintenance")} disabled={importLoading !== null} />
                    </label>
                    
                    <button 
                        onClick={() => handleDeleteAll("groupTypes", "Maintenance")}
                        disabled={isDeleting === "groupTypes"}
                        className="bg-rose-50 text-rose-600 px-4 py-2 rounded-2xl font-medium hover:bg-rose-100 transition flex items-center gap-2 text-sm shadow-sm border border-rose-100"
                    >
                        <Trash2 className="w-4 h-4" />
                        {isDeleting === 'groupTypes' ? 'Deleting...' : `Delete All Group Types (${groupTypes.length})`}
                    </button>
                </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-stone-200 space-y-6 shadow-sm">
                <h3 className="text-lg font-medium border-b border-stone-100 pb-2">Table: Groups</h3>
                <div className="flex flex-wrap gap-4 items-center">
                    <button 
                        onClick={() => handleSampleExport("groups")}
                        className="bg-stone-100 text-stone-700 px-4 py-2 rounded-2xl font-medium hover:bg-stone-200 transition border border-stone-200 flex items-center gap-2 text-sm shadow-sm"
                    >
                        <Download className="w-4 h-4" />
                        Sample Export
                    </button>
                    <label className="bg-amber-50 text-stone-800 px-4 py-2 rounded-2xl font-medium cursor-pointer hover:bg-amber-100 transition relative flex items-center gap-2 text-sm border border-amber-200 shadow-sm">
                        <Upload className="w-4 h-4" />
                        {importLoading === "groups" ? "Importing..." : "Import CSV"}
                        <input type="file" className="hidden" accept=".csv" onChange={(e) => handleFileUpload(e, "groups", "Maintenance")} disabled={importLoading !== null} />
                    </label>
                    
                    <button 
                        onClick={() => handleDeleteAll("groups", "Maintenance")}
                        disabled={isDeleting === "groups"}
                        className="bg-rose-50 text-rose-600 px-4 py-2 rounded-2xl font-medium hover:bg-rose-100 transition flex items-center gap-2 text-sm shadow-sm border border-rose-100"
                    >
                        <Trash2 className="w-4 h-4" />
                        {isDeleting === 'groups' ? 'Deleting...' : `Delete All Groups (${groups.length})`}
                    </button>
                </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-stone-200 space-y-6 shadow-sm">
                <h3 className="text-lg font-medium border-b border-stone-100 pb-2">Table: Group Members</h3>
                <div className="flex flex-wrap gap-4 items-center">
                    <button 
                        onClick={() => handleSampleExport("groupMembers")}
                        className="bg-stone-100 text-stone-700 px-4 py-2 rounded-2xl font-medium hover:bg-stone-200 transition border border-stone-200 flex items-center gap-2 text-sm shadow-sm"
                    >
                        <Download className="w-4 h-4" />
                        Sample Export
                    </button>
                    <label className="bg-amber-50 text-stone-800 px-4 py-2 rounded-2xl font-medium cursor-pointer hover:bg-amber-100 transition relative flex items-center gap-2 text-sm border border-amber-200 shadow-sm">
                        <Upload className="w-4 h-4" />
                        {importLoading === "groupMembers" ? "Importing..." : "Import CSV"}
                        <input type="file" className="hidden" accept=".csv" onChange={(e) => handleFileUpload(e, "groupMembers", "Maintenance")} disabled={importLoading !== null} />
                    </label>
                    
                    <button 
                        onClick={() => handleDeleteAll("groupMembers", "Maintenance")}
                        disabled={isDeleting === "groupMembers"}
                        className="bg-rose-50 text-rose-600 px-4 py-2 rounded-2xl font-medium hover:bg-rose-100 transition flex items-center gap-2 text-sm shadow-sm border border-rose-100"
                    >
                        <Trash2 className="w-4 h-4" />
                        {isDeleting === 'groupMembers' ? 'Deleting...' : `Delete All Group Members (${groupMembers.length})`}
                    </button>
                </div>
            </div>
        </div>
    );
};
