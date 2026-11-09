import React, { useState, useEffect } from "react";
import { useAdmin } from "../context/AdminContext";
import { X, ChevronDown, ChevronRight, Edit2, Trash2 } from "lucide-react";
import { formatEventTimeRange } from "../lib/dateUtils";
import { resolveAccessLink } from "../lib/rosterUtils";

interface PersonDetailsModalProps {
    onClose: () => void;
}

export const PersonDetailsModal: React.FC<PersonDetailsModalProps> = ({ onClose }) => {
    const { 
        selectedPersonDetails, 
        setSelectedPersonDetails, 
        people, 
        groupMembers, 
        groups, 
        events, 
        rosters,
        handleApproveNewMember,
        handleDeclineNewMember,
        updatePerson,
        setConfirmDialog
    } = useAdmin();

    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState({
        firstName: "",
        lastName: "",
        email: "",
        qualifies: false,
        supportPersonId: "",
        supportPersonName: ""
    });

    useEffect(() => {
        if (selectedPersonDetails) {
            setEditData({
                firstName: selectedPersonDetails.firstName || "",
                lastName: selectedPersonDetails.lastName || "",
                email: selectedPersonDetails.email || "",
                qualifies: selectedPersonDetails.qualifies === true,
                supportPersonId: selectedPersonDetails.supportPersonId || "",
                supportPersonName: selectedPersonDetails.supportPersonName || ""
            });
            setIsEditing(false);
        }
    }, [selectedPersonDetails]);

    if (!selectedPersonDetails) return null;

    const toggleExpand = (groupId: string) => {
        setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
    };

    const handleSave = async () => {
        try {
            await updatePerson(selectedPersonDetails.id, editData);
            setIsEditing(false);
        } catch (error) {
            // Error is handled in context
        }
    };

    const isNewApproval = ['new_member', 'new_support'].includes(String(selectedPersonDetails.type || "").toLowerCase());

    const linkInfo = resolveAccessLink(selectedPersonDetails, groupMembers);

    const personGroups = groupMembers
        .filter(gm => gm.personId === selectedPersonDetails.id)
        .map(gm => {
            const group = groups.find(g => g.id === gm.groupId);
            return { ...gm, group };
        })
        .filter(gm => gm.group);

    const displayType = selectedPersonDetails.type === "new_member" ? "New Member" : selectedPersonDetails.type === "new_support" ? "New Support" : selectedPersonDetails.type;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-stone-200">
                <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-stone-100">
                    <div>
                        <h3 className="text-xl font-bold text-stone-900">{selectedPersonDetails.firstName} {selectedPersonDetails.lastName}</h3>
                        <p className="text-sm text-stone-500 capitalize font-medium">{displayType}</p>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 text-stone-400 hover:text-stone-600 hover:bg-white rounded-full transition-all border border-transparent hover:border-stone-100"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-stone-50">
                    {isNewApproval && (
                        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 mb-6 flex flex-wrap justify-between items-center gap-3 shadow-xs">
                            <div className="flex-1 min-w-0">
                                <h4 className="text-sm font-bold text-indigo-950">Approval Required</h4>
                                <p className="text-xs text-indigo-700 font-semibold">
                                    This person was loaded by a group leader. Admin approval is required to permanently assign member/carer status.
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        setConfirmDialog({
                                            isOpen: true,
                                            title: "Decline and Remove",
                                            message: `Are you sure you want to decline and remove ${selectedPersonDetails.firstName} ${selectedPersonDetails.lastName}? This will permanently delete this person.`,
                                            confirmText: "Decline & Remove",
                                            confirmClass: "bg-red-600 hover:bg-red-700",
                                            onConfirm: async () => {
                                                setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }));
                                                await handleDeclineNewMember(selectedPersonDetails.id);
                                                onClose();
                                            },
                                            onCancel: () => setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }))
                                        });
                                    }}
                                    className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-100 transition shadow-sm"
                                >
                                    Decline and Remove
                                </button>
                                <button
                                    onClick={() => {
                                        setConfirmDialog({
                                            isOpen: true,
                                            title: "Confirm Approval",
                                            message: `Are you sure you want to permanently approve ${selectedPersonDetails.firstName} ${selectedPersonDetails.lastName}?`,
                                            confirmText: "Approve",
                                            confirmClass: "bg-indigo-600 hover:bg-indigo-700",
                                            onConfirm: async () => {
                                                setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }));
                                                await handleApproveNewMember(selectedPersonDetails.id);
                                            },
                                            onCancel: () => setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }))
                                        });
                                    }}
                                    className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-700 transition shadow-sm border border-indigo-700"
                                >
                                    Approve Permanent Status
                                </button>
                            </div>
                        </div>
                    )}
                    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5 mb-6">
                        <div className="flex justify-between items-center mb-4 border-b border-stone-100 pb-2">
                            <h4 className="font-bold text-stone-800 text-sm uppercase tracking-wider">Person Details</h4>
                            {!isEditing && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            setConfirmDialog({
                                                isOpen: true,
                                                title: "Delete Person",
                                                message: `Are you sure you want to permanently delete ${selectedPersonDetails.firstName} ${selectedPersonDetails.lastName}? This action cannot be undone.`,
                                                confirmText: "Delete",
                                                confirmClass: "bg-red-600 hover:bg-red-700",
                                                onConfirm: async () => {
                                                    setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }));
                                                    await handleDeclineNewMember(selectedPersonDetails.id);
                                                    onClose();
                                                },
                                                onCancel: () => setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }))
                                            });
                                        }}
                                        className="text-red-500 hover:text-red-700 transition flex items-center gap-1 text-xs font-bold bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg"
                                    >
                                        <Trash2 className="w-3 h-3" /> Delete
                                    </button>
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className="text-stone-500 hover:text-amber-600 transition flex items-center gap-1 text-xs font-bold bg-stone-100 hover:bg-amber-50 px-2 py-1 rounded-lg"
                                    >
                                        <Edit2 className="w-3 h-3" /> Edit
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            {isEditing ? (
                                <>
                                    <div>
                                        <label className="text-stone-500 block mb-1 font-medium">First Name</label>
                                        <input
                                            type="text"
                                            value={editData.firstName}
                                            onChange={(e) => setEditData({...editData, firstName: e.target.value})}
                                            className="w-full border border-stone-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-stone-500 block mb-1 font-medium">Last Name</label>
                                        <input
                                            type="text"
                                            value={editData.lastName}
                                            onChange={(e) => setEditData({...editData, lastName: e.target.value})}
                                            className="w-full border border-stone-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-stone-500 block mb-1 font-medium">Email</label>
                                        <input
                                            type="email"
                                            value={editData.email}
                                            onChange={(e) => setEditData({...editData, email: e.target.value})}
                                            className="w-full border border-stone-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-stone-500 block mb-1 font-medium">Qualifying condition</label>
                                        <label className="flex items-center gap-2 py-1.5">
                                            <input
                                                type="checkbox"
                                                checked={editData.qualifies}
                                                onChange={(e) => setEditData({...editData, qualifies: e.target.checked})}
                                                className="w-4 h-4 rounded border-stone-300 text-amber-500 focus:ring-amber-500"
                                            />
                                            <span className="text-stone-700">Qualifies for membership</span>
                                        </label>
                                        <p className="text-[11px] text-stone-400 leading-snug mt-0.5">
                                            Whether a qualifying condition applies. The diagnosis itself is not recorded.
                                        </p>
                                    </div>
                                    <div>
                                        <label className="text-stone-500 block mb-1 font-medium">Support Person Name</label>
                                        <input
                                            type="text"
                                            value={editData.supportPersonName}
                                            onChange={(e) => setEditData({...editData, supportPersonName: e.target.value})}
                                            className="w-full border border-stone-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                                            placeholder="E.g. John Doe (optional)"
                                        />
                                    </div>
                                    <div className="col-span-1 md:col-span-2 mt-2 flex justify-end gap-2">
                                        <button
                                            onClick={() => setIsEditing(false)}
                                            className="px-4 py-2 text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-xl text-sm font-bold transition"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSave}
                                            className="px-4 py-2 bg-amber-500 text-white hover:bg-amber-600 rounded-xl text-sm font-bold shadow-sm transition"
                                        >
                                            Save Changes
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <span className="text-stone-500 block mb-1 font-medium">Email</span>
                                        <span className="font-semibold text-stone-900">{selectedPersonDetails.email || <span className="italic text-stone-400 font-normal">None</span>}</span>
                                    </div>
                                    <div>
                                        <span className="text-stone-500 block mb-1 font-medium">Qualifying condition</span>
                                        <span className="font-semibold text-stone-900">
                                            {selectedPersonDetails.qualifies
                                                ? "Yes"
                                                : <span className="italic text-stone-400 font-normal">No</span>}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-stone-500 block mb-1 font-medium">Support Person</span>
                                        {(() => {
                                            if (selectedPersonDetails.supportPersonId) {
                                                const supportPerson = people.find(p => p.id === selectedPersonDetails.supportPersonId);
                                                if (supportPerson) {
                                                    return (
                                                        <button 
                                                            onClick={() => setSelectedPersonDetails(supportPerson)}
                                                            className="font-semibold text-blue-600 hover:text-blue-800 hover:underline text-left outline-none"
                                                        >
                                                            {selectedPersonDetails.supportPersonName}
                                                        </button>
                                                    );
                                                }
                                            }
                                            return <span className="font-semibold text-stone-900">{selectedPersonDetails.supportPersonName || <span className="italic text-stone-400 font-normal">None</span>}</span>;
                                        })()}
                                    </div>
                                </>
                            )}
                            
                            {!isEditing && (
                                <div>
                                    <span className="text-stone-500 block mb-1 font-medium">Access Link</span>
                                    {linkInfo ? (
                                        <a 
                                            href={linkInfo.url}
                                            target="_blank" 
                                            rel="noreferrer"
                                            className="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-semibold bg-stone-100 text-stone-800 hover:bg-amber-50 border border-stone-200 hover:border-amber-200 transition-all shadow-sm"
                                        >
                                            {linkInfo.label}
                                        </a>
                                    ) : (
                                        <span className="text-stone-400 italic">None Needed</span>
                                    )}
                                </div>
                            )}
                            {(() => {
                                const supportedPeople = people.filter(p => p.supportPersonId === selectedPersonDetails.id);
                                if (supportedPeople.length > 0) {
                                    return (
                                        <div className="col-span-1 md:col-span-2 mt-2">
                                            <span className="text-stone-500 block mb-2 font-medium">Supported People</span>
                                            <div className="flex flex-wrap gap-2">
                                                {supportedPeople.map(sp => (
                                                    <button
                                                        key={sp.id}
                                                        onClick={() => setSelectedPersonDetails(sp)}
                                                        className="font-semibold text-blue-600 hover:text-blue-800 hover:underline text-left bg-blue-50 px-2.5 py-1.5 rounded-md border border-blue-100 text-sm outline-none"
                                                    >
                                                        {sp.firstName} {sp.lastName}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                    </div>

                    <h4 className="font-bold text-stone-800 text-sm uppercase tracking-wider mb-4 px-2">Groups & Events</h4>
                    <div className="space-y-4">
                        {personGroups.length === 0 ? (
                            <p className="text-stone-500 italic px-2">Not assigned to any groups.</p>
                        ) : (
                            personGroups.map(pg => {
                                const isExpanded = expandedGroups[pg.groupId];
                                const groupEvents = events
                                    .filter(e => e.groupId === pg.groupId)
                                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                                return (
                                    <div key={pg.groupId} className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                                        <button 
                                            onClick={() => toggleExpand(pg.groupId)}
                                            className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-stone-50 transition-colors outline-none"
                                        >
                                            <div className="flex flex-col">
                                                <span className="font-bold text-stone-900 text-base">{pg.group?.name}</span>
                                                <span className="text-xs text-stone-500 font-semibold uppercase tracking-wider">{pg.role}</span>
                                            </div>
                                            {isExpanded ? <ChevronDown className="w-5 h-5 text-stone-400" /> : <ChevronRight className="w-5 h-5 text-stone-400" />}
                                        </button>
                                        
                                        {isExpanded && (
                                            <div className="border-t border-stone-100 bg-stone-50/50">
                                                {groupEvents.length === 0 ? (
                                                    <p className="text-stone-500 italic p-4 text-center text-sm">No events found for this group.</p>
                                                ) : (
                                                    <div className="overflow-x-auto">
                                                        <table className="w-full text-left text-sm">
                                                            <thead className="bg-stone-100 text-stone-500 border-b border-stone-200 text-xs font-bold uppercase tracking-wider">
                                                                <tr>
                                                                    <th className="px-5 py-3">Date</th>
                                                                    <th className="px-5 py-3">Event Name</th>
                                                                    <th className="px-5 py-3 text-center">Status</th>
                                                                    <th className="px-5 py-3 text-center">RSVP</th>
                                                                    <th className="px-5 py-3 text-center">Attendance</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-stone-100">
                                                                {groupEvents.map(ev => {
                                                                    const rosterEntry = rosters.find(r => r.eventId === ev.id && r.personId === selectedPersonDetails.id);
                                                                    const rsvp = String(rosterEntry?.rsvpStatus || "").toLowerCase();
                                                                    const attendance = String(rosterEntry?.attendanceStatus || "").toLowerCase();

                                                                    return (
                                                                        <tr key={ev.id} className="hover:bg-white transition-colors">
                                                                            <td className="px-5 py-3 whitespace-nowrap">
                                                                                <div className="font-semibold text-stone-900">{ev.date}</div>
                                                                                <div className="text-[10px] text-stone-500 font-bold uppercase">{formatEventTimeRange(ev.time, ev.duration, ev.title)}</div>
                                                                            </td>
                                                                            <td className="px-5 py-3 text-stone-800 font-semibold">{ev.title}</td>
                                                                            <td className="px-5 py-3 text-center">
                                                                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                                                    ev.status === 'exported' ? 'bg-emerald-100 text-emerald-700' :
                                                                                    ev.status === 'approved' ? 'bg-amber-100 text-stone-900' :
                                                                                    'bg-yellow-100 text-yellow-700'
                                                                                }`}>
                                                                                    {ev.status || 'pending'}
                                                                                </span>
                                                                            </td>
                                                                            <td className="px-5 py-3 text-center">
                                                                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${
                                                                                    rsvp === 'booked' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                                                                    rsvp === 'cancelled' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                                                                                    'bg-stone-100 text-stone-500 border-stone-200'
                                                                                }`}>
                                                                                    {rsvp || 'Unknown'}
                                                                                </span>
                                                                            </td>
                                                                            <td className="px-5 py-3 text-center">
                                                                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${
                                                                                    attendance === 'present' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                                                                    attendance === 'no-show' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                                                                                    'bg-stone-100 text-stone-500 border-stone-200'
                                                                                }`}>
                                                                                    {attendance || 'Unknown'}
                                                                                </span>
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
export default PersonDetailsModal;
