import React, { useState } from "react";
import { useAdmin } from "../../context/AdminContext";
import { Clock, MapPin, X } from "lucide-react";
import { formatEventTimeRange, parseEventDate } from "../../lib/dateUtils";
import AdminEventRowDetails from "../AdminEventRowDetails";

export const EventsTab: React.FC = () => {
    const { 
        events, 
        groups, 
        groupTypes, 
        rosters, 
        people, 
        groupMembers,
        loadTabData, 
        refreshing,
        handleAdminAction,
        handleExportToInfoodle,
        handleAdminSubmitRoster
    } = useAdmin();

    const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
    const [expandedEventGroups, setExpandedEventGroups] = useState<Record<string, boolean>>({});

    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const filteredEvents = events.filter(() => true);

    const groupedEvents: any = {};
    filteredEvents.forEach(e => {
        const group = groups.find(g => g.id === e.groupId);
        const type = groupTypes.find(gt => gt.id === group?.groupTypeId);
        const typeName = type?.longValue || 'Other';
        const groupName = group?.name || 'Unknown Group';

        if (!groupedEvents[typeName]) groupedEvents[typeName] = {};
        if (!groupedEvents[typeName][groupName]) groupedEvents[typeName][groupName] = [];
        groupedEvents[typeName][groupName].push(e);
    });

    const todaysEvents = events.filter(e => {
        const d = parseEventDate(e.date);
        d.setHours(0, 0, 0, 0);
        const isToday = d.getTime() === todayStart.getTime();
        const isPastActive = d.getTime() < todayStart.getTime() && e.status !== 'exported' && e.status !== 'submitted';
        return isToday || isPastActive;
    }).sort((a, b) => {
        const dateA = parseEventDate(a.date).getTime();
        const dateB = parseEventDate(b.date).getTime();
        if (dateA !== dateB) return dateB - dateA;
        return (a.time || "").localeCompare(b.time || "");
    });

    const EventRow = ({ e, isPast }: { e: any; isPast: boolean }) => {
        const eventRosters = rosters.filter(r => r.eventId === e.id);
        const bookedCount = eventRosters.filter(r => r.rsvpStatus === 'booked').length;
        const attendedCount = eventRosters.filter(r => r.attendanceStatus === 'present').length;
        const isExpanded = expandedEventId === e.id;
        const group = groups.find(g => g.id === e.groupId);
        const isLateAndActive = isPast && e.status !== 'submitted' && e.status !== 'exported';

        return (
            <React.Fragment>
                <tr 
                    className={`transition-colors cursor-pointer ${isExpanded ? (isLateAndActive ? 'bg-rose-50/50' : 'bg-stone-50') : 'hover:bg-stone-50'} ${isLateAndActive ? 'bg-rose-50/30' : ''}`}
                    onClick={() => setExpandedEventId(isExpanded ? null : e.id)}
                >
                    <td className="p-3">
                        <div className={`font-semibold ${isLateAndActive ? 'text-rose-900' : 'text-stone-900'}`}>{e.date}</div>
                        <div className={`text-xs ${isLateAndActive ? 'text-rose-600' : 'text-stone-500'} font-medium uppercase tracking-wider`}>
                            {formatEventTimeRange(e.time, e.duration, e.title)} {group ? `• ${group.name}` : ''}
                        </div>
                    </td>
                    <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            isLateAndActive ? 'bg-rose-100 text-rose-700' :
                            e.status === 'exported' ? 'bg-emerald-100 text-emerald-700' :
                            e.status === 'approved' ? 'bg-amber-100 text-stone-900' :
                            'bg-yellow-100 text-yellow-700'
                        }`}>
                            {isLateAndActive ? 'late' : (e.status || 'pending')}
                        </span>
                    </td>
                    <td className="p-3 text-center font-bold">
                        {isPast ? (
                            <span className={isLateAndActive ? 'text-rose-700' : 'text-emerald-600'}>{attendedCount} present</span>
                        ) : (
                            <span className="text-stone-800">{bookedCount} booked</span>
                        )}
                    </td>
                </tr>
            </React.Fragment>
        );
    };

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
                <h2 className="text-2xl font-bold text-stone-900">Events Dashboard</h2>
                <button 
                    onClick={() => loadTabData("Events")} 
                    disabled={refreshing}
                    className="text-xs font-bold text-stone-500 hover:text-stone-900 flex items-center gap-1 group bg-stone-100 px-3 py-1.5 rounded-full"
                >
                    <Clock className={`w-3 h-3 ${refreshing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* TODAYS EVENTS SECTION */}
            <div className="space-y-4">
                <h3 className="text-xl font-extrabold text-stone-950 flex items-center gap-2 border-l-4 border-indigo-600 pl-3 uppercase tracking-wider">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse inline-block" />
                    ACTIVE & TODAY'S EVENTS
                </h3>
                <div className="bg-white rounded-3xl shadow-sm border border-stone-200 overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-stone-50 text-stone-500 border-b border-stone-100 text-xs font-bold uppercase tracking-wider">
                            <tr>
                                <th className="p-3">Time / Group</th>
                                <th className="p-3 text-center">Status</th>
                                <th className="p-3 text-center">Booked/Attended</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-50">
                            {todaysEvents.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="p-8 text-center text-stone-400 italic">
                                        No active events scheduled for today.
                                    </td>
                                </tr>
                            ) : (
                                todaysEvents.map(e => {
                                    return <EventRow key={e.id} e={e} isPast={parseEventDate(e.date) < todayStart} />;
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {Object.entries(groupedEvents).map(([typeName, groupData]: [string, any]) => (
                <div key={typeName} className="space-y-4">
                    <h3 className="text-xl font-semibold text-stone-800 border-l-4 border-stone-800 pl-3">{typeName}</h3>
                    <div className="grid grid-cols-1 gap-6 ml-4">
                        {Object.entries(groupData).map(([groupName, groupEvents]: [string, any[]]) => {
                            const in30Days = new Date(now);
                            in30Days.setDate(in30Days.getDate() + 30);
                            in30Days.setHours(23, 59, 59, 999);

                            const sortedEvents = [...groupEvents].sort((a,b) => {
                                const dateA = parseEventDate(a.date).getTime();
                                const dateB = parseEventDate(b.date).getTime();
                                if (isNaN(dateA) || isNaN(dateB)) {
                                    return b.date.localeCompare(a.date);
                                }
                                return dateB - dateA;
                            });

                            const completedEvents = sortedEvents.filter(e => parseEventDate(e.date) < todayStart);
                            const upcomingEvents = sortedEvents.filter(e => parseEventDate(e.date) >= todayStart);
                            
                            const mainEvents = upcomingEvents.filter(e => parseEventDate(e.date) <= in30Days);
                            const futureEvents = upcomingEvents.filter(e => parseEventDate(e.date) > in30Days);

                            const isFutureExpanded = expandedEventGroups[`future-${typeName}-${groupName}`];
                            const toggleFuture = () => setExpandedEventGroups(prev => ({...prev, [`future-${typeName}-${groupName}`]: !prev[`future-${typeName}-${groupName}`]}));
                            
                            const isCompletedExpanded = expandedEventGroups[`completed-${typeName}-${groupName}`];
                            const toggleCompleted = () => setExpandedEventGroups(prev => ({...prev, [`completed-${typeName}-${groupName}`]: !prev[`completed-${typeName}-${groupName}`]}));

                            return (
                                <div key={groupName} className="bg-white rounded-3xl shadow-sm border border-stone-200 overflow-hidden">
                                    <div className="bg-stone-100 px-4 py-2 border-b border-stone-200 font-medium text-stone-700">
                                        {groupName}
                                    </div>
                                    <table className="w-full text-left text-sm">
                                        <thead>
                                            <tr className="text-stone-500 border-b border-stone-100">
                                                <th className="p-3 font-medium">Date/Time</th>
                                                <th className="p-3 font-medium text-center">Status</th>
                                                <th className="p-3 font-medium text-center">Booked/Attended</th>
                                            </tr>
                                        </thead>
                                        
                                        {futureEvents.length > 0 && (
                                            <tbody className="divide-y divide-stone-100 border-b border-stone-200">
                                                <tr>
                                                    <td colSpan={3} className="p-0">
                                                        <button 
                                                            onClick={toggleFuture} 
                                                            className="w-full text-left px-4 py-2 bg-indigo-50/50 hover:bg-indigo-50 transition-colors text-indigo-700 font-semibold text-xs uppercase tracking-wider outline-none"
                                                        >
                                                            Future Events &gt;
                                                        </button>
                                                    </td>
                                                </tr>
                                                {isFutureExpanded && futureEvents.map(e => <EventRow key={e.id} e={e} isPast={false} />)}
                                            </tbody>
                                        )}

                                        <tbody className="divide-y divide-stone-100 border-b border-stone-200">
                                            {mainEvents.map(e => <EventRow key={e.id} e={e} isPast={false} />)}
                                            {mainEvents.length === 0 && upcomingEvents.length === 0 && (
                                                <tr><td colSpan={3} className="p-4 text-center text-stone-500 italic">No upcoming events this month.</td></tr>
                                            )}
                                        </tbody>

                                        {completedEvents.length > 0 && (
                                            <tbody className="divide-y divide-stone-100">
                                                <tr>
                                                    <td colSpan={3} className="p-0">
                                                        <button 
                                                            onClick={toggleCompleted} 
                                                            className="w-full text-left px-4 py-2 bg-stone-50 hover:bg-stone-100 transition-colors text-stone-600 font-semibold text-xs uppercase tracking-wider outline-none"
                                                        >
                                                            Completed Events &gt;
                                                        </button>
                                                    </td>
                                                </tr>
                                                {isCompletedExpanded && completedEvents.map(e => <EventRow key={e.id} e={e} isPast={true} />)}
                                            </tbody>
                                        )}
                                    </table>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
            
            {expandedEventId && (
                (() => {
                    const expandedEv = filteredEvents.find(e => e.id === expandedEventId);
                    if (expandedEv) {
                        const group = groups.find(g => g.id === expandedEv.groupId);
                        const timeStr = formatEventTimeRange(expandedEv.time, expandedEv.duration, expandedEv.title);
                        const isLateAndActive = parseEventDate(expandedEv.date) < todayStart && String(expandedEv.status || "pending").toLowerCase() !== 'submitted' && String(expandedEv.status || "pending").toLowerCase() !== 'exported';
                        
                        return (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                                <div className="bg-stone-100 rounded-3xl border border-stone-200 shadow-2xl overflow-hidden w-[90vw] max-w-[1800px] max-h-[95vh] flex flex-col relative">
                                    <div className={`flex justify-between items-start p-6 border-b border-stone-200/60 sticky top-0 z-10 w-full gap-4 ${isLateAndActive ? 'bg-rose-50' : 'bg-white'}`}>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-col gap-1.5 w-full pr-4">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <h2 className={`text-xl font-bold leading-tight ${isLateAndActive ? 'text-rose-900' : 'text-stone-900'}`}>{group?.name || 'Unknown Group'}</h2>
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider inline-block shrink-0 ${
                                                        isLateAndActive ? 'bg-rose-100 text-rose-700 border border-rose-200' :
                                                        String(expandedEv.status || 'pending').toLowerCase() === 'exported' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                                                        String(expandedEv.status || 'pending').toLowerCase() === 'submitted' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                                                        String(expandedEv.status || 'pending').toLowerCase() === 'approved' ? 'bg-amber-50 text-stone-900 border border-amber-100' :
                                                        'bg-amber-50 text-amber-700 border border-amber-100'
                                                    }`}>
                                                        {isLateAndActive ? 'late' : (expandedEv.status || 'pending')}
                                                    </span>
                                                </div>
                                                <div className="text-stone-600 font-semibold text-sm flex flex-wrap items-center gap-1.5">
                                                    <span>{timeStr}</span>
                                                    <span className="text-stone-300">•</span>
                                                    <span>{parseEventDate(expandedEv.date).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                </div>
                                                <div className="text-stone-500 font-medium text-sm flex items-center gap-1.5">
                                                    <MapPin className="w-3.5 h-3.5 text-stone-400" />
                                                    <span>{group?.locationName || 'Location Not Specified'}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <button 
                                            autoFocus
                                            onClick={() => setExpandedEventId(null)}
                                            className="text-stone-500 hover:text-stone-800 bg-stone-100 hover:bg-stone-200 p-2 rounded-full transition-colors shrink-0 ml-4"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>
                                    <div className="p-6 overflow-y-auto flex-1 bg-transparent">
                                        <AdminEventRowDetails
                                            event={expandedEv}
                                            people={people}
                                            groupMembers={groupMembers}
                                            rosters={rosters}
                                            handleAdminAction={handleAdminAction}
                                            handleExportToInfoodle={handleExportToInfoodle}
                                            handleSubmitRoster={handleAdminSubmitRoster}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    }
                    return null;
                })()
            )}
        </div>
    );
};
