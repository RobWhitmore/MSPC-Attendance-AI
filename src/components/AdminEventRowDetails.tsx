import { useState } from "react";
import { MessageSquare, Download, Search, UserCheck } from "lucide-react";
import { AppEvent, Person, Group, Roster, GroupMember } from "../types";
import { useAdmin } from "../context/AdminContext";
import { parseEventDate } from "../lib/dateUtils";

export default function AdminEventRowDetails({
    event,
    people,
    groupMembers,
    rosters,
    handleAdminAction,
    handleExportToInfoodle,
    handleSubmitRoster
}: {
    event: AppEvent,
    people: Person[],
    groupMembers: GroupMember[],
    rosters: Roster[],
    handleAdminAction: (eventId: string, personId: string, action: string, value: string) => Promise<void>,
    handleExportToInfoodle: (event: AppEvent) => void,
    handleSubmitRoster: (eventId: string) => void
}) {
    const { handleApproveNewMember, handleDeclineNewMember, setSelectedPersonDetails, setConfirmDialog } = useAdmin();
    const [search, setSearch] = useState("");
    const [rosterFilter, setRosterFilter] = useState("all");
    const [editingNoteFor, setEditingNoteFor] = useState<string | null>(null);

    const groupMemberPersonIds = groupMembers
        .filter((gm: GroupMember) => gm.groupId === event.groupId)
        .map((gm: GroupMember) => gm.personId);
    
    // Union of people who are group members AND people who have a roster entry for this specific event
    const rosterPersonIds = rosters
        .filter((r: Roster) => r.eventId === event.id)
        .map((r: Roster) => r.personId);
    
    const allRelevantPersonIds = Array.from(new Set([...groupMemberPersonIds, ...rosterPersonIds]));
    
    // Process attendees with roster info
    let attendeesList = allRelevantPersonIds.map((pid: string) => {
        const roster = rosters.find((r: Roster) => r.eventId === event.id && r.personId === pid);
        const gm = groupMembers.find((gm: GroupMember) => gm.groupId === event.groupId && gm.personId === pid);
        const pObj = people.find((p: Person) => p.id === pid);
        const name = `${pObj?.firstName || ""} ${pObj?.lastName || ""}`.trim() || 'Unknown Person';
        return {
            personId: pid,
            name,
            role: gm?.role || 'member',
            personType: pObj?.type || 'Unknown',
            rsvp: roster?.rsvpStatus || 'potential',
            attendance: roster?.attendanceStatus || 'unknown',
            note: roster?.note || '',
            email: pObj?.email || '',
            phone: pObj?.phone || ''
        };
    });

    const newApprovals = attendeesList.filter(a => ['new_member', 'new_support'].includes(String(a.personType).toLowerCase().trim()));

    const typePriority: Record<string, number> = {
        'member': 1,
        'new_member': 1,
        'support': 2,
        'new_support': 2,
        'admin': 3,
        'staff': 4,
        'contact': 5,
        'unknown': 99
    };

    // Group attendees by support combinations
    let processedAttendees = new Set();
    let groupedAttendeesList: {type: 'single' | 'pair', attendees: any[]}[] = [];
    
    for (const attendee of attendeesList) {
        if (processedAttendees.has(attendee.personId)) continue;
        
        const personObj = people.find((p: Person) => p.id === attendee.personId);
        let linkedAttendee = null;

        if (personObj) {
            if (personObj.supportPersonId) {
                linkedAttendee = attendeesList.find((a: any) => a.personId === personObj.supportPersonId);
            } else {
                const supportedByMe = people.find((p: Person) => p.supportPersonId === personObj.id);
                if (supportedByMe) {
                    linkedAttendee = attendeesList.find((a: any) => a.personId === supportedByMe.id);
                }
            }
        }

        if (linkedAttendee && !processedAttendees.has(linkedAttendee.personId)) {
            let pair = [attendee, linkedAttendee];
            pair.sort((a, b) => {
                const pA = typePriority[String(a.personType).toLowerCase().trim()] || 99;
                const pB = typePriority[String(b.personType).toLowerCase().trim()] || 99;
                if (pA !== pB) return pA - pB;
                return a.name.localeCompare(b.name);
            });
            groupedAttendeesList.push({ type: 'pair', attendees: pair });
            processedAttendees.add(linkedAttendee.personId);
        } else {
            groupedAttendeesList.push({ type: 'single', attendees: [attendee] });
        }
        processedAttendees.add(attendee.personId);
    }

    groupedAttendeesList.sort((a, b) => {
        const leftA = a.attendees[0];
        const leftB = b.attendees[0];
        const pA = typePriority[String(leftA.personType).toLowerCase()] || 99;
        const pB = typePriority[String(leftB.personType).toLowerCase()] || 99;
        
        if (pA !== pB) return pA - pB;
        return leftA.name.localeCompare(leftB.name);
    });

    if (search) {
        groupedAttendeesList = groupedAttendeesList.filter(groupItem => 
            groupItem.attendees.some(a => a.name.toLowerCase().includes(search.toLowerCase()))
        );
    }

    if (rosterFilter !== "all") {
        groupedAttendeesList = groupedAttendeesList.filter(groupItem => {
            return groupItem.attendees.some(a => {
                const pType = String(a.personType).toLowerCase().trim();
                if (rosterFilter === "new") {
                    return ['new_member', 'new_support'].includes(pType);
                }
                if (rosterFilter === "member") {
                    return ['member', 'new_member'].includes(pType);
                }
                if (rosterFilter === "support") {
                    return ['support', 'new_support'].includes(pType);
                }
                return pType === rosterFilter;
            });
        });
    }

    const eventDateObj = parseEventDate(event.date);
    eventDateObj.setHours(0, 0, 0, 0);
    const todayObj = new Date();
    todayObj.setHours(0, 0, 0, 0);
    const isPastOrToday = eventDateObj.getTime() <= todayObj.getTime();
    const status = String(event.status || "").toLowerCase();

    const getRsvpInfo = (rsvp: string) => {
        const value = String(rsvp || "").toLowerCase().trim();
        if (value === 'booked') {
            return { label: 'Booked', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
        } else if (value === 'cancelled') {
            return { label: 'Cancelled', bg: 'bg-rose-50 text-rose-700 border-rose-200' };
        } else {
            return { label: 'Potential', bg: 'bg-stone-50 text-stone-600 border-stone-200' };
        }
    };

    const handleRsvpCycle = (attendee: any) => {
        const current = String(attendee.rsvp || "").toLowerCase().trim();
        let nextValue = 'booked';
        if (current === 'booked') {
            nextValue = 'cancelled';
        } else if (current === 'cancelled') {
            nextValue = 'potential';
        } else {
            nextValue = 'booked';
        }
        handleAdminAction(event.id, attendee.personId, 'rsvp', nextValue);
    };

    const getAttendanceInfo = (attendance: string) => {
        const value = String(attendance || "").toLowerCase().trim();
        if (value === 'present') {
            return { label: 'Present', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
        } else if (value === 'no-show') {
            return { label: 'No Show', bg: 'bg-amber-50 text-amber-700 border-amber-200' };
        } else {
            return { label: 'Potential', bg: 'bg-stone-50 text-stone-600 border-stone-200' };
        }
    };

    const handleAttendCycle = (attendee: any) => {
        const current = String(attendee.attendance || "").toLowerCase().trim();
        const rsvp = String(attendee.rsvp || "").toLowerCase().trim();
        let nextValue = 'present';
        if (current === 'present') {
            if (rsvp === 'booked') {
                nextValue = 'no-show';
            } else {
                nextValue = 'potential';
            }
        } else if (current === 'no-show') {
            nextValue = 'potential';
        } else {
            nextValue = 'present';
        }
        const backendValue = nextValue === 'potential' ? 'unknown' : nextValue;
        handleAdminAction(event.id, attendee.personId, 'attendance', backendValue);
    };

    const renderPersonCard = (attendee: any) => {
        const rsvpInfo = getRsvpInfo(attendee.rsvp);
        const attendInfo = getAttendanceInfo(attendee.attendance);
        const isNew = attendee.personType === 'new_member' || attendee.personType === 'new_support';
        const displayType = attendee.personType === 'new_member' ? 'New Member' : attendee.personType === 'new_support' ? 'New Support' : attendee.personType;
        
        return (
            <div key={attendee.personId} id={`person-card-${attendee.personId}`} className={`flex flex-col justify-between p-3.5 border ${isNew ? 'border-l-4 border-l-indigo-500 border-indigo-200 bg-indigo-50/10' : 'border-stone-200/60 bg-white'} rounded-2xl flex-1 shadow-sm relative hover:shadow-md transition-all`}>
                <div>
                    {/* Person Name & Type Badge */}
                    <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                        <h5 className={`font-bold text-stone-800 text-xs sm:text-sm leading-snug ${attendee.role && attendee.role.toLowerCase() !== attendee.personType.toLowerCase() ? 'md:truncate md:max-w-[120px]' : ''}`} title={attendee.name}>{attendee.name}</h5>
                        {isNew && (
                            <span className="bg-indigo-600 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded shadow-xs leading-none shrink-0">New</span>
                        )}
                        {attendee.role && attendee.role.toLowerCase() !== attendee.personType.toLowerCase() && (
                            <span className={`text-[8px] border px-1.5 py-0.5 rounded-full font-extrabold uppercase tracking-wider shrink-0 ${attendee.role.toLowerCase() === 'leader' ? 'bg-amber-100 border-amber-200/50 text-amber-800' : 'bg-stone-100 border-stone-200/50 text-stone-600'}`}>{attendee.role}</span>
                        )}
                    </div>

                    {/* Person Note Section */}
                    {(editingNoteFor === attendee.personId || attendee.note) && (
                        <div className="mb-3">
                            {editingNoteFor === attendee.personId ? (
                                <div className="flex gap-1.5 w-full">
                                    <input 
                                        id={`note-input-${attendee.personId}`}
                                        type="text" 
                                        defaultValue={attendee.note}
                                        className="flex-1 w-full border border-stone-300 focus:ring-1 focus:ring-amber-500 text-xs rounded-xl px-2.5 py-1 focus:outline-none bg-white"
                                        placeholder="Add a note..."
                                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                            if (e.key === 'Enter') handleAdminAction(event.id, attendee.personId, 'note', (e.target as HTMLInputElement | HTMLSelectElement).value);
                                            if (e.key === 'Escape') setEditingNoteFor(null);
                                        }}
                                        onBlur={(e: React.FocusEvent<HTMLInputElement>) => handleAdminAction(event.id, attendee.personId, 'note', (e.target as HTMLInputElement | HTMLSelectElement).value)}
                                        autoFocus
                                    />
                                </div>
                            ) : attendee.note ? (
                                <div 
                                    onClick={() => setEditingNoteFor(attendee.personId)}
                                    className="group flex items-start gap-1.5 text-[11px] text-stone-400 hover:text-stone-700 font-medium w-full text-left transition-colors cursor-pointer"
                                    title="Edit Note"
                                >
                                    <span className="italic text-stone-600 line-clamp-2 leading-relaxed">"{attendee.note}"</span>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>

                {/* Cyclist Control Buttons: RSVP & ATTEND */}
                <div className="space-y-2 mt-auto pt-2 border-t border-stone-200/40 flex flex-col justify-start">
                    {/* RSVP Cyclist */}
                    <div className="flex items-center justify-between gap-1.5 h-[28px]">
                        <button 
                            id={`note-btn-${attendee.personId}`}
                            onClick={() => setEditingNoteFor(attendee.personId)}
                            className="text-stone-400 hover:text-stone-700 transition-colors shrink-0 w-[60px] flex justify-start"
                            title="Add Note"
                        >
                            <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                        <button 
                            id={`rsvp-cycle-btn-${attendee.personId}`}
                            onClick={() => handleRsvpCycle(attendee)}
                            className={`flex-1 text-[11px] font-bold py-1 px-2.5 rounded-xl border text-center transition-all cursor-pointer hover:shadow-xs ${rsvpInfo.bg}`}
                        >
                            {rsvpInfo.label === 'Potential' ? 'RSVP' : rsvpInfo.label}
                        </button>
                    </div>
                    
                    {/* ATTEND Cyclist */}
                    <div className={`flex items-center justify-between gap-1.5 h-[28px] ${attendee.rsvp === 'cancelled' ? 'hidden' : ''}`}>
                        <span className={`text-[11px] font-extrabold ${isNew ? 'text-indigo-600' : 'text-stone-400'} uppercase tracking-wider shrink-0 w-[60px] truncate`} title={displayType}>{displayType}</span>
                        <button 
                            id={`attend-cycle-btn-${attendee.personId}`}
                            disabled={!isPastOrToday || attendee.rsvp === 'cancelled'}
                            onClick={() => handleAttendCycle(attendee)}
                            className={`flex-1 text-[11px] font-bold py-1 px-2.5 rounded-xl border text-center transition-all ${
                                isPastOrToday ? 'cursor-pointer hover:shadow-xs ' + attendInfo.bg : 'opacity-40 cursor-not-allowed ' + attendInfo.bg
                            }`}
                        >
                            {attendInfo.label === 'Potential' ? 'ATTEND' : attendInfo.label}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div id={`event-roster-details-${event.id}`} className="space-y-4 p-4 bg-stone-50/50 rounded-b-3xl border-t border-stone-200 col-span-6">
            {/* Header: Search on left, Actions on right */}
            <div className="flex flex-wrap justify-between items-center gap-3 px-1">
                {/* Search and filters for attendees */}
                <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                    <div className="relative w-full max-w-sm sm:w-64">
                        <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input 
                            id={`roster-search-${event.id}`}
                            type="text" 
                            placeholder="Search Roster..." 
                            value={search} 
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch((e.target as HTMLInputElement | HTMLSelectElement).value)} 
                            className="w-full bg-white border border-stone-200 rounded-xl pl-9 pr-4 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-xs"
                        />
                    </div>
                    {/* Roster Filter Pills */}
                    <div className="flex flex-wrap gap-1">
                        {[
                            { id: 'all', label: 'All' },
                            { id: 'new', label: 'New Approvals' },
                            { id: 'member', label: 'Members' },
                            { id: 'support', label: 'Support' }
                        ].map(btn => (
                            <button
                                key={btn.id}
                                onClick={() => setRosterFilter(btn.id)}
                                className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition-all ${
                                    rosterFilter === btn.id 
                                    ? "bg-stone-800 text-white shadow-xs" 
                                    : "bg-white text-stone-600 border border-stone-200 hover:bg-stone-50"
                                }`}
                            >
                                {btn.label}
                            </button>
                        ))}
                    </div>
                </div>
                
                <div className="flex items-center gap-2 ml-auto">
                    {status === 'submitted' ? (
                        <div className="flex items-center gap-2">
                            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-3 py-1 rounded-2xl font-bold uppercase tracking-wider">
                                ✓ Submitted
                            </span>
                            <button 
                                id={`export-infoodle-btn-${event.id}`}
                                onClick={() => handleExportToInfoodle(event)}
                                className="bg-emerald-600 text-white px-4 py-1.5 rounded-2xl text-xs font-bold hover:bg-emerald-700 transition shadow-sm flex items-center gap-2 border border-emerald-700"
                            >
                                <Download className="w-3.5 h-3.5" /> Export to Infoodle Now
                            </button>
                        </div>
                    ) : (
                        <button 
                            id={`submit-roster-btn-${event.id}`}
                            onClick={(ev) => { ev.stopPropagation(); handleSubmitRoster(event.id); }}
                            className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-1.5 rounded-2xl text-xs font-bold transition shadow-sm border border-amber-700 whitespace-nowrap"
                        >
                            Submit Roster
                        </button>
                    )}
                </div>
            </div>

            {/* Extras reported by the leader on submission - people who came but are not in the group */}
            {event.extrasNote && (
                <div className="mb-6 bg-amber-50/40 border border-amber-200/80 rounded-2xl p-5 shadow-sm">
                    <h4 className="text-sm font-bold text-amber-950">Extras reported by the leader</h4>
                    <p className="text-xs text-amber-800 font-semibold mb-2">Attended but not in the group. Follow up in Infoodle.</p>
                    <p className="text-sm text-stone-800 whitespace-pre-wrap">{event.extrasNote}</p>
                </div>
            )}

            {/* New Approvals Awaiting Admin Approval */}
            {newApprovals.length > 0 && (
                <div className="mb-6 bg-indigo-50/40 border border-indigo-200/80 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700">
                            <UserCheck className="w-4 h-4" />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-indigo-950">Approval Required: New Members & Carers</h4>
                            <p className="text-xs text-indigo-700 font-semibold">The following people were loaded by the group leader. Admin approval is required to permanently assign regular member/carer status.</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {newApprovals.map(na => (
                            <div key={na.personId} className="bg-white border border-indigo-200 rounded-xl p-4 shadow-xs flex flex-col justify-between">
                                <div className="mb-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[9px] bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider">
                                            {na.personType === 'new_support' ? 'New Support Carer' : 'New Member'}
                                        </span>
                                    </div>
                                    <h5 className="font-bold text-stone-950 text-sm mb-1">{na.name}</h5>
                                    <div className="space-y-1 text-xs text-stone-600 font-medium">
                                        {na.phone && <p>📞 {na.phone}</p>}
                                        {na.email && <p>✉️ {na.email}</p>}
                                        {na.note && <p className="italic text-stone-500 bg-stone-50 p-1.5 rounded-md mt-1.5">"{na.note}"</p>}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setSelectedPersonDetails(people.find(p => p.id === na.personId) || null)}
                                        className="flex-1 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold py-2 rounded-xl transition text-center shadow-xs"
                                    >
                                        View Profile
                                    </button>
                                    <button
                                        onClick={() => {
                                            setConfirmDialog({
                                                isOpen: true,
                                                title: "Confirm Approval",
                                                message: `Are you sure you want to permanently approve ${na.name}?`,
                                                confirmText: "Approve",
                                                confirmClass: "bg-indigo-600 hover:bg-indigo-700",
                                                onConfirm: async () => {
                                                    setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }));
                                                    await handleApproveNewMember(na.personId);
                                                },
                                                onCancel: () => setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }))
                                            });
                                        }}
                                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm border border-indigo-700"
                                    >
                                        Approve
                                    </button>
                                    <button
                                        onClick={() => {
                                            setConfirmDialog({
                                                isOpen: true,
                                                title: "Decline and Remove",
                                                message: `Are you sure you want to decline and remove ${na.name}? This will permanently delete this person.`,
                                                confirmText: "Decline & Remove",
                                                confirmClass: "bg-red-600 hover:bg-red-700",
                                                onConfirm: async () => {
                                                    setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }));
                                                    await handleDeclineNewMember(na.personId);
                                                },
                                                onCancel: () => setConfirmDialog((prev: any) => ({ ...prev, isOpen: false }))
                                            });
                                        }}
                                        className="flex-none bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-bold px-3 py-2 rounded-xl transition flex items-center justify-center shadow-sm"
                                        title="Decline and Remove"
                                    >
                                        Decline
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Main grid containing grouped attendees */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {groupedAttendeesList.length === 0 ? (
                    <div className="col-span-full py-8 text-center text-stone-500 bg-stone-50/50 rounded-2xl border border-dashed border-stone-200">
                        No attendees found.
                    </div>
                ) : (
                    groupedAttendeesList.map((groupItem, gIdx) => {
                        if (groupItem.type === 'pair') {
                            return (
                                <div key={gIdx} className="bg-stone-200/60 border border-stone-300/60 rounded-2xl p-3 transition-all flex flex-col gap-3 md:col-span-2">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 divide-y md:divide-y-0 md:divide-x divide-stone-100 h-full">
                                        <div className="flex flex-col justify-between gap-3 pr-0 md:pr-4 pt-1 md:pt-0 h-full">
                                            {renderPersonCard(groupItem.attendees[0])}
                                        </div>
                                        <div className="flex flex-col justify-between gap-3 pl-0 md:pl-4 pt-3 md:pt-0 border-t md:border-t-0 border-stone-100 h-full">
                                            {renderPersonCard(groupItem.attendees[1])}
                                        </div>
                                    </div>
                                </div>
                            );
                        } else {
                            return (
                                <div key={gIdx} className="bg-transparent border border-transparent rounded-2xl p-0 transition-all flex flex-col justify-between gap-3">
                                    {renderPersonCard(groupItem.attendees[0])}
                                </div>
                            );
                        }
                    })
                )}
            </div>
        </div>
    );
}
