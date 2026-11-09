import React, { useState } from "react";
import { useAdmin } from "../../context/AdminContext";
import { Clock, Upload, X, Trash2, Plus } from "lucide-react";
import { parseEventDate } from "../../lib/dateUtils";

export const GroupsTab: React.FC = () => {
    const { 
        groups, 
        groupTypes, 
        events, 
        rosters, 
        groupMembers, 
        people, 
        loadTabData, 
        refreshing, 
        handleGroupCsvSelect,
        reclassifyPersonIfNeeded,
        addGroupMember,
        updateGroupMemberRole,
        removeGroupMember
    } = useAdmin();

    const [selectedGroupForMembers, setSelectedGroupForMembers] = useState<any | null>(null);
    const [newMemberPersonId, setNewMemberPersonId] = useState("");
    const [newMemberRole, setNewMemberRole] = useState("member");
    const [isLinkingMember, setIsLinkingMember] = useState(false);

    const now = new Date();
    const nextMonth = new Date();
    nextMonth.setMonth(now.getMonth() + 1);
    const lastMonth = new Date();
    lastMonth.setMonth(now.getMonth() - 1);

    const groupedGroups: any = {};
    groupTypes.forEach(gt => groupedGroups[gt.longValue || gt.shortValue] = []);
    groups.forEach(g => {
        const type = groupTypes.find(gt => gt.id === g.groupTypeId);
        const typeName = type?.longValue || 'Other';
        if (!groupedGroups[typeName]) groupedGroups[typeName] = [];
        groupedGroups[typeName].push(g);
    });

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4">
                <h2 className="text-2xl font-bold text-stone-900">Groups Administration</h2>
                <button 
                    onClick={() => loadTabData("Groups")} 
                    disabled={refreshing}
                    className="text-xs font-bold text-stone-500 hover:text-stone-900 flex items-center gap-1 group bg-stone-100 px-3 py-1.5 rounded-full"
                >
                    <Clock className={`w-3 h-3 ${refreshing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>
            
            {Object.entries(groupedGroups).sort((a, b) => b[0].localeCompare(a[0])).map(([typeName, groupList]: [string, any[]]) => (
                <div key={typeName} className="bg-white rounded-3xl border border-stone-200 overflow-hidden shadow-sm">
                    <div className="bg-stone-800 px-5 py-4 text-white font-bold">
                        {typeName}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-stone-50 text-stone-500 border-b border-stone-200 text-xs uppercase font-bold tracking-wider">
                                <tr>
                                    <th className="p-4">Group Name</th>
                                    <th className="p-4">Schedule</th>
                                    <th className="p-4 text-center">Total Members</th>
                                    <th className="p-4 text-center">Next Month (Booked)</th>
                                    <th className="p-4 text-center">Last Month (Attended)</th>
                                    <th className="p-4">Who</th>
                                    <th className="p-4">Location</th>
                                    <th className="p-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {groupList.sort((a,b) => a.name.localeCompare(b.name)).map(g => {
                                    const groupEvents = events.filter(e => e.groupId === g.id);
                                    
                                    const nextMonthEvents = groupEvents.filter(e => {
                                        const d = parseEventDate(e.date);
                                        return d >= now && d <= nextMonth;
                                    });
                                    const bookedNextMonth = rosters.filter(r => 
                                        nextMonthEvents.some(e => e.id === r.eventId) && r.rsvpStatus === 'booked'
                                    ).length;

                                    const lastMonthEvents = groupEvents.filter(e => {
                                        const d = parseEventDate(e.date);
                                        return d >= lastMonth && d <= now;
                                    });
                                    const attendedLastMonth = rosters.filter(r => 
                                        lastMonthEvents.some(e => e.id === r.eventId) && r.attendanceStatus === 'present'
                                    ).length;

                                    const totalMembers = groupMembers.filter(gm => gm.groupId === g.id).length;

                                    return (
                                        <tr key={g.id} className="hover:bg-stone-50 group cursor-pointer" onClick={() => setSelectedGroupForMembers(g)}>
                                            <td className="p-4 font-semibold text-stone-900 group-hover:text-stone-800 transition-colors underline decoration-dotted decoration-stone-300 underline-offset-4">{g.name}</td>
                                            <td className="p-4">
                                                <div className="text-stone-700 whitespace-normal text-sm leading-relaxed max-w-[200px] break-words">
                                                    {g.timeRule || ""} {g.dateRule || ""}
                                                </div>
                                            </td>
                                            <td className="p-4 text-center">
                                                <div className="text-stone-900 font-bold">{totalMembers}</div>
                                            </td>
                                            <td className="p-4 text-center">
                                                <div className="text-stone-900 font-bold">{nextMonthEvents.length} events</div>
                                                <div className="text-xs text-amber-500">{bookedNextMonth} people</div>
                                            </td>
                                            <td className="p-4 text-center">
                                                <div className="text-emerald-700 font-bold">{lastMonthEvents.length} events</div>
                                                <div className="text-xs text-emerald-500">{attendedLastMonth} people</div>
                                            </td>
                                            <td className="p-4 text-stone-500">{g.who || ""}</td>
                                            <td className="p-4 text-stone-500">{g.locationName || ""}</td>
                                            <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                <label className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-xl text-xs font-semibold hover:bg-amber-100 cursor-pointer transition border border-amber-200 shadow-sm">
                                                    <Upload className="w-3.5 h-3.5" />
                                                    Import CSV
                                                    <input type="file" className="hidden" accept=".csv" onChange={(e) => handleGroupCsvSelect(e, g.id, g.name)} />
                                                </label>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {groupList.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="p-8 text-center text-stone-400 italic">No groups in this category.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}

            {selectedGroupForMembers && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-stone-200">
                        <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-stone-100">
                            <div>
                                <h3 className="text-xl font-bold text-stone-900">{selectedGroupForMembers.name}</h3>
                                <p className="text-sm text-stone-500 font-medium">Group Membership & Leaders</p>
                            </div>
                            <button 
                                onClick={() => {
                                    setSelectedGroupForMembers(null);
                                    setNewMemberPersonId("");
                                    setNewMemberRole("member");
                                }}
                                className="p-2 text-stone-400 hover:text-stone-600 hover:bg-white rounded-full transition-all border border-transparent hover:border-stone-100"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        {/* Link Person Section */}
                        <div className="px-6 py-4 border-b border-stone-100 bg-stone-50">
                            <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Link/Assign Person to this Group</h4>
                            <div className="flex flex-wrap md:flex-nowrap gap-3 items-end">
                                <div className="flex-1 min-w-[200px]">
                                    <label className="block text-[11px] text-stone-500 font-medium mb-1">Select Person</label>
                                    <select
                                        value={newMemberPersonId}
                                        onChange={(e) => setNewMemberPersonId(e.target.value)}
                                        className="w-full text-xs bg-white border border-stone-200 rounded-xl px-3 py-2 text-stone-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                    >
                                        <option value="">-- Choose Person --</option>
                                        {(() => {
                                            const currentMemberIds = new Set(
                                                groupMembers
                                                    .filter(gm => gm.groupId === selectedGroupForMembers.id)
                                                    .map(gm => gm.personId)
                                            );
                                            return people
                                                .filter(p => !currentMemberIds.has(p.id))
                                                .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
                                                .map(p => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.firstName} {p.lastName} ({p.type?.toUpperCase() || 'MEMBER'})
                                                    </option>
                                                ));
                                        })()}
                                    </select>
                                </div>
                                <div className="w-32">
                                    <label className="block text-[11px] text-stone-500 font-medium mb-1">Group Role</label>
                                    <select
                                        value={newMemberRole}
                                        onChange={(e) => setNewMemberRole(e.target.value)}
                                        className="w-full text-xs bg-white border border-stone-200 rounded-xl px-3 py-2 text-stone-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                    >
                                        <option value="member">Member</option>
                                        <option value="leader">Leader</option>
                                        <option value="staff">Staff</option>
                                        <option value="support">Support</option>
                                        <option value="speaker">Speaker</option>
                                    </select>
                                </div>
                                <button
                                    type="button"
                                    disabled={!newMemberPersonId || isLinkingMember}
                                    onClick={async () => {
                                        if (!newMemberPersonId) return;
                                        setIsLinkingMember(true);
                                        try {
                                            const added = await addGroupMember(
                                                selectedGroupForMembers.id,
                                                newMemberPersonId,
                                                newMemberRole
                                            );
                                            if (added) {
                                                await reclassifyPersonIfNeeded(newMemberPersonId, undefined, newMemberRole);
                                                setNewMemberPersonId("");
                                                setNewMemberRole("member");
                                                await loadTabData('Groups');
                                            }
                                        } catch (err) {
                                            console.error("Error linking member: ", err);
                                        } finally {
                                            setIsLinkingMember(false);
                                        }
                                    }}
                                    className="px-4 py-2 bg-stone-800 text-white hover:bg-stone-900 disabled:bg-stone-300 disabled:cursor-not-allowed rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shrink-0 h-[34px]"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    {isLinkingMember ? "Linking..." : "Link Person"}
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-0">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-stone-100 text-stone-500 border-b border-stone-100 sticky top-0 z-10 font-bold text-xs uppercase">
                                    <tr>
                                        <th className="px-6 py-3">Member Name & Person Type</th>
                                        <th className="px-6 py-3">Role in Group</th>
                                        <th className="px-6 py-3">Contact</th>
                                        <th className="px-6 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-50">
                                    {(() => {
                                        const members = groupMembers
                                            .filter(gm => gm.groupId === selectedGroupForMembers.id)
                                            .map(gm => {
                                                const p = people.find(person => person.id === gm.personId);
                                                return { ...gm, person: p };
                                            })
                                            .filter(m => m.person)
                                            .sort((a, b) => {
                                                const roleA = (a.role || 'member').toLowerCase();
                                                const roleB = (b.role || 'member').toLowerCase();
                                                if (roleA !== roleB) return roleA.localeCompare(roleB);

                                                const nameA = `${a.person.firstName} ${a.person.lastName}`.toLowerCase();
                                                const nameB = `${b.person.firstName} ${b.person.lastName}`.toLowerCase();
                                                return nameA.localeCompare(nameB);
                                            });

                                        if (members.length === 0) {
                                            return (
                                                <tr>
                                                    <td colSpan={4} className="px-6 py-12 text-center text-stone-400 italic">
                                                        No members assigned to this group yet.
                                                    </td>
                                                </tr>
                                            );
                                        }

                                        return members.map(m => (
                                            <tr key={m.id} className="hover:bg-stone-50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="font-semibold text-stone-900">{m.person.firstName} {m.person.lastName}</div>
                                                    <div className="text-xs text-stone-400 font-medium">Person Type: <span className="uppercase">{m.person.type || 'member'}</span></div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <select
                                                        value={m.role || 'member'}
                                                        onChange={async (e) => {
                                                            const newRole = e.target.value;
                                                            try {
                                                                await updateGroupMemberRole(m.id, newRole);
                                                                await reclassifyPersonIfNeeded(m.personId);
                                                                await loadTabData('Groups');
                                                            } catch (err) {
                                                                console.error("Error updating role:", err);
                                                            }
                                                        }}
                                                        className="text-xs bg-white border border-stone-200 rounded-lg px-2.5 py-1 text-stone-700 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
                                                    >
                                                        <option value="member">Member</option>
                                                        <option value="leader">Leader</option>
                                                        <option value="staff">Staff</option>
                                                        <option value="support">Support</option>
                                                        <option value="speaker">Speaker</option>
                                                    </select>
                                                </td>
                                                <td className="px-6 py-4 text-stone-500 text-xs">
                                                    {m.person.email || <span className="italic text-stone-300">No Email</span>}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <button
                                                        onClick={async () => {
                                                            if (window.confirm(`Are you sure you want to remove ${m.person.firstName} ${m.person.lastName} from this group?`)) {
                                                                try {
                                                                    await removeGroupMember(m.id);
                                                                    await reclassifyPersonIfNeeded(m.personId);
                                                                    await loadTabData('Groups');
                                                                } catch (err) {
                                                                    console.error("Error unlinking member: ", err);
                                                                }
                                                            }
                                                        }}
                                                        className="p-1 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors inline-flex items-center justify-center"
                                                        title="Unlink/Remove member"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ));
                                    })()}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-6 py-4 border-t border-stone-100 bg-stone-100 flex justify-end">
                            <button 
                                onClick={() => {
                                    setSelectedGroupForMembers(null);
                                    setNewMemberPersonId("");
                                    setNewMemberRole("member");
                                }}
                                className="px-6 py-2 bg-stone-800 text-white rounded-2xl font-semibold shadow-sm hover:bg-stone-900 transition-all active:scale-95"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
