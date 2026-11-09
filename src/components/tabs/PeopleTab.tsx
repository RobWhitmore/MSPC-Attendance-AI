import React, { useState } from "react";
import { useAdmin } from "../../context/AdminContext";
import { Clock, Search, X, Users } from "lucide-react";
import { resolveAccessLink } from "../../lib/rosterUtils";

export const PeopleTab: React.FC = () => {
    const { 
        people, 
        groupMembers, 
        rosters, 
        events, 
        loadTabData, 
        refreshing, 
        setSelectedPersonDetails 
    } = useAdmin();

    const [peopleSearch, setPeopleSearch] = useState("");
    const [peopleFilter, setPeopleFilter] = useState("all");

    const sortedPeople = [...people]
        .sort((a, b) => {
            const nameA = `${a.firstName} ${a.lastName}`.toLowerCase();
            const nameB = `${b.firstName} ${b.lastName}`.toLowerCase();
            return nameA.localeCompare(nameB);
        })
        .filter(p => {
            const searchStr = `${p.firstName} ${p.lastName} ${p.email || ""}`.toLowerCase();
            const matchesSearch = searchStr.includes(peopleSearch.toLowerCase());
            const matchesFilter = peopleFilter === 'all' || 
                (peopleFilter === 'new' && ['new_member', 'new_support'].includes(String(p.type || "").toLowerCase())) ||
                p.type === peopleFilter;
            return matchesSearch && matchesFilter;
        });

    const filterTypes = [
        { id: 'all', label: 'All' },
        { id: 'new', label: 'New Approvals' },
        { id: 'member', label: 'Members' },
        { id: 'support', label: 'Support' },
        { id: 'staff', label: 'Staff' },
        { id: 'admin', label: 'Admin' }
    ];

    return (
        <div className="flex flex-col gap-6 h-full max-h-[calc(100vh-5rem)]">
            <div className="flex justify-between items-center shrink-0">
                <h2 className="text-2xl font-bold text-stone-900 font-sans tracking-tight">People</h2>
                <button 
                    onClick={() => loadTabData("People")} 
                    disabled={refreshing}
                    className="text-xs font-bold text-stone-500 hover:text-stone-900 flex items-center gap-1 group bg-stone-100 px-3 py-1.5 rounded-full"
                >
                    <Clock className={`w-3 h-3 ${refreshing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
                {filterTypes.map(type => (
                    <button
                        key={type.id}
                        onClick={() => {
                            setPeopleFilter(type.id);
                            setPeopleSearch("");
                        }}
                        className={`px-4 py-2 rounded-2xl text-sm font-medium transition-all ${
                            peopleFilter === type.id 
                            ? "bg-stone-800 text-white shadow-sm" 
                            : "bg-white text-stone-600 border border-stone-200 hover:bg-stone-100"
                        }`}
                    >
                        {type.label}
                    </button>
                ))}
                
                <div className="relative w-full sm:w-64 sm:ml-2">
                    <input
                        type="text"
                        placeholder="Search Name and Email..."
                        value={peopleSearch}
                        onChange={(e) => setPeopleSearch(e.target.value)}
                        className="w-full pl-10 pr-10 py-2 bg-white border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-stone-500 text-sm"
                    />
                    <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    {peopleSearch && (
                        <button 
                            onClick={() => setPeopleSearch("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col min-h-0">
                <div className="overflow-auto">
                    <table className="w-full text-left text-sm text-stone-600 border-separate border-spacing-0">
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-stone-100">
                                <th className="p-4 font-semibold text-xs uppercase tracking-wider text-stone-500 border-b border-stone-200">Name</th>
                                <th className="p-4 font-semibold text-xs uppercase tracking-wider text-stone-500 border-b border-stone-200">Type</th>
                                <th className="p-4 font-semibold text-xs uppercase tracking-wider text-stone-500 border-b border-stone-200 text-center">Groups</th>
                                <th className="p-4 font-semibold text-xs uppercase tracking-wider text-stone-500 border-b border-stone-200 text-center">Future Bookings</th>
                                <th className="p-4 font-semibold text-xs uppercase tracking-wider text-stone-500 border-b border-stone-200">Qualifies</th>
                                <th className="p-4 font-semibold text-xs uppercase tracking-wider text-stone-500 border-b border-stone-200">Support</th>
                                <th className="p-4 font-semibold text-xs uppercase tracking-wider text-stone-500 border-b border-stone-200">Access Link</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                            {sortedPeople.map(p => {
                                const memberCount = groupMembers.filter(gm => {
                                    const personId = String(gm.personId || "").trim();
                                    return personId === p.id || (p.infoodleId && personId === String(p.infoodleId).trim());
                                }).length;

                                const futureBookingsCount = rosters.filter(r => {
                                    const personId = String(r.personId || "").trim();
                                    const isMatch = personId === p.id || (p.infoodleId && personId === String(p.infoodleId).trim());
                                    if (!isMatch || r.rsvpStatus !== 'booked') return false;
                                    const event = events.find(e => e.id === r.eventId);
                                    return event && event.date && new Date(event.date) >= new Date();
                                }).length;

                                return (
                                    <tr 
                                        key={p.id} 
                                        className="hover:bg-stone-100/80 transition-colors group cursor-pointer"
                                        onClick={() => setSelectedPersonDetails(p)}
                                    >
                                        <td className="p-4 font-medium text-stone-900 border-b border-stone-100">
                                            <div className="flex flex-col">
                                                <span>{p.firstName} {p.lastName}</span>
                                                <span className="text-xs text-stone-400 font-normal">{p.email || ""}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 border-b border-stone-100 italic font-sans">
                                            {p.type === 'admin' ? (
                                                <span className="bg-rose-50 text-rose-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-rose-100 shadow-sm">Admin</span>
                                            ) : p.type === 'staff' ? (
                                                <span className="bg-purple-50 text-purple-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-purple-100 shadow-sm">Staff</span>
                                            ) : p.type === 'support' ? (
                                                <span className="bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-emerald-100 shadow-sm">Support</span>
                                            ) : p.type === 'new_support' ? (
                                                <span className="bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-indigo-100 shadow-sm">New Support</span>
                                            ) : p.type === 'leader' ? (
                                                <span className="bg-orange-50 text-orange-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-orange-100 shadow-sm">Leader</span>
                                            ) : p.type === 'member' ? (
                                                <span className="bg-amber-50 text-stone-900 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-amber-100 shadow-sm">Member</span>
                                            ) : p.type === 'new_member' ? (
                                                <span className="bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-indigo-100 shadow-sm">New Member</span>
                                            ) : (
                                                <span className="capitalize text-xs text-stone-500">{p.type}</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-center border-b border-stone-100">
                                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-50 text-stone-900 text-xs font-bold border border-amber-100">
                                                {memberCount}
                                            </span>
                                        </td>
                                        <td className="p-4 text-center border-b border-stone-100">
                                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold border ${
                                                futureBookingsCount > 0 ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-stone-100 text-stone-400 border-stone-100"
                                            }`}>
                                                {futureBookingsCount}
                                            </span>
                                        </td>
                                        <td className="p-4 border-b border-stone-100">
                                            <div className="max-w-[150px] truncate group-hover:whitespace-normal group-hover:overflow-visible group-hover:relative group-hover:bg-white group-hover:z-20 transition-all duration-200">
                                                {p.qualifies ? "Yes" : <span className="text-stone-300 italic">No</span>}
                                            </div>
                                        </td>
                                        <td className="p-4 text-xs border-b border-stone-100">
                                            {p.supportPersonId ? (
                                                (() => {
                                                    const sp = people.find(person => person.id === p.supportPersonId);
                                                    return sp ? (
                                                        <div className="flex flex-col">
                                                            <span className="font-medium text-stone-700">{sp.firstName} {sp.lastName}</span>
                                                            <span className="text-[10px] text-stone-400">Linked Support</span>
                                                        </div>
                                                    ) : <span className="text-stone-400 italic">Unknown ({p.supportPersonId})</span>;
                                                })()
                                            ) : p.supportPersonName ? (
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-stone-700">{p.supportPersonName}</span>
                                                    <span className="text-[10px] text-stone-400 italic">Not Linked</span>
                                                </div>
                                            ) : <span className="text-stone-400 italic">None</span>}
                                        </td>
                                        <td className="p-4 border-b border-stone-100">
                                            {(() => {
                                                const linkInfo = resolveAccessLink(p, groupMembers);

                                                return (
                                                    <a 
                                                        href={linkInfo.url}
                                                        target="_blank" 
                                                        rel="noreferrer"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-semibold bg-stone-100 text-stone-800 hover:bg-amber-50 border border-stone-200 hover:border-stone-300 transition-all shadow-sm"
                                                    >
                                                        {linkInfo.label}
                                                    </a>
                                                );
                                            })()}
                                        </td>
                                    </tr>
                                );
                            })}
                            {sortedPeople.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="p-12 text-center text-stone-400">
                                        <div className="flex flex-col items-center gap-3">
                                            <Users className="w-12 h-12 text-stone-200" />
                                            <p className="text-base font-medium">No people found matching your criteria.</p>
                                            <p className="text-sm">Try adjusting your search or filters.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
