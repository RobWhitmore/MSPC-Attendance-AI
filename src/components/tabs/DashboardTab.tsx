import React, { useState, useEffect, useRef } from "react";
import { useAdmin } from "../../context/AdminContext";
import { Calendar as BigCalendar, momentLocalizer } from "react-big-calendar";
import moment from "moment";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { 
  Clock, Download, ChevronDown, ChevronRight, CalendarPlus, MapPin, X, Search 
} from "lucide-react";
import AdminEventRowDetails from "../AdminEventRowDetails";
import { formatEventTimeRange, parseEventDate } from "../../lib/dateUtils";

const localizer = momentLocalizer(moment);

const CustomAgendaDate = ({ day }: { day: Date }) => {
    const today = new Date();
    const isSameYear = day.getFullYear() === today.getFullYear();
    const formattedDate = moment(day).format(isSameYear ? "ddd DD MMM" : "ddd DD MMM YYYY");
    return (
        <span className="font-mono whitespace-nowrap text-stone-700">{formattedDate}</span>
    );
};

const CustomAgendaEvent = ({ event }: { event: any }) => {
    const eventRef = useRef<HTMLDivElement>(null);
    const status = String(event.resource?.status || "pending").toLowerCase();
    
    useEffect(() => {
        if (eventRef.current) {
            const tr = eventRef.current.closest("tr");
            if (tr) {
                tr.setAttribute("data-event-id", event.id);
                tr.classList.add("cursor-pointer", "hover:bg-stone-100", "transition-colors");
            }
        }
    }, [event.id]);

    return (
        <div ref={eventRef} className={`font-medium pointer-events-none flex flex-row items-center ${event.isLateAndActive ? "text-rose-800" : "text-stone-800"}`}>
            <div className="w-5/12 pr-4">{event.title}</div>
            <div className={`w-4/12 pr-4 font-normal ${event.isLateAndActive ? "text-rose-600" : "text-stone-500"}`}>{event.locationName}</div>
            <div className="w-3/12">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider inline-block ${
                    event.isLateAndActive ? "bg-rose-100 text-rose-700 border border-rose-200" :
                    status === "exported" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                    status === "submitted" ? "bg-blue-50 text-blue-700 border border-blue-100" :
                    status === "approved" ? "bg-amber-50 text-stone-900 border border-amber-100" :
                    "bg-amber-50 text-amber-700 border border-amber-100"
                }`}>
                    {event.isLateAndActive ? "late" : (event.resource?.status || "pending")}
                </span>
            </div>
        </div>
    );
};

export const DashboardTab: React.FC = () => {
    const { 
        events, 
        groups, 
        groupTypes, 
        rosters, 
        people, 
        groupMembers,
        loadTabData,
        refreshing,
        isGeneratingEvents,
        handleGenerateEvents,
        handleExportToInfoodle,
        handleAdminAction,
        handleAdminSubmitRoster
    } = useAdmin();

    const [dashboardSearch, setDashboardSearch] = useState("");
    const [calDate, setCalDate] = useState(new Date());
    const [hasSetInitialCalDate, setHasSetInitialCalDate] = useState(false);
    const [calView, setCalView] = useState(() => localStorage.getItem("adminCalView") || "agenda");
    const [dashboardMajorGroupFilter, setDashboardMajorGroupFilter] = useState("all");
    const [dashboardMinorGroupFilter, setDashboardMinorGroupFilter] = useState("all");
    const [dashboardLocationFilter, setDashboardLocationFilter] = useState(() => localStorage.getItem("adminDashboardLocationFilter") || "all");
    const [expandedSubmitted, setExpandedSubmitted] = useState(false);
    const [expandedExported, setExpandedExported] = useState(false);
    const [expandedCancelled, setExpandedCancelled] = useState(false);
    const [expandedDashboardEvent, setExpandedDashboardEvent] = useState<string | null>(null);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    useEffect(() => {
        if (events.length > 0 && !hasSetInitialCalDate) {
            let oldestLateActiveDate: Date | null = null;
            const tDate = new Date();
            tDate.setHours(0, 0, 0, 0);

            events.forEach(e => {
                const status = String(e.status || "pending").toLowerCase();
                if (status !== "submitted" && status !== "exported" && status !== "cancelled") {
                    const d = parseEventDate(e.date);
                    d.setHours(0, 0, 0, 0);
                    if (d.getTime() < tDate.getTime()) {
                        if (!oldestLateActiveDate || d.getTime() < oldestLateActiveDate.getTime()) {
                            oldestLateActiveDate = d;
                        }
                    }
                }
            });
            
            if (oldestLateActiveDate) {
                setCalDate(oldestLateActiveDate);
            }
            setHasSetInitialCalDate(true);
        }
    }, [events, hasSetInitialCalDate]);

    useEffect(() => {
        if (expandedDashboardEvent) {
          loadTabData("Dashboard");
        }
    }, [expandedDashboardEvent, loadTabData]);

    const filteredDashboardEvents = events.filter(e => {
        const g = groups.find(x => x.id === e.groupId);
        const gt = groupTypes.find(x => x.id === g?.groupTypeId);
        
        if (dashboardMajorGroupFilter !== "all" && gt?.id !== dashboardMajorGroupFilter) return false;
        if (dashboardMinorGroupFilter !== "all" && g?.id !== dashboardMinorGroupFilter) return false;
        if (dashboardLocationFilter !== "all" && g?.locationName !== dashboardLocationFilter) return false;
        
        if (dashboardSearch) {
            const term = dashboardSearch.toLowerCase();
            let matches = false;
            if (g?.name?.toLowerCase().includes(term)) matches = true;
            if (g?.locationName?.toLowerCase().includes(term)) matches = true;
            
            if (!matches) return false;
        }
        return true;
    }).sort((a, b) => parseEventDate(b.date).getTime() - parseEventDate(a.date).getTime());

    const calendarEvents = filteredDashboardEvents.filter(e => {
        const status = String(e.status || "").toLowerCase();
        return status !== "exported" && status !== "cancelled";
    });
    
    const calObjects = calendarEvents.map(e => {
        const d = parseEventDate(e.date);
        let start = new Date(d);
        let end = new Date(d);
        end.setHours(23, 59, 59);
        
        if (e.time) {
            let h = 0, m = 0, parsed = false;
            const timeStr = formatEventTimeRange(e.time, e.duration, e.title);
            const timeMatch = timeStr.match(/(\d+)[:.](\d+)\s*(am|pm)?/i);
            if (timeMatch) {
                h = parseInt(timeMatch[1], 10);
                m = parseInt(timeMatch[2], 10);
                const ampm = timeMatch[3]?.toLowerCase();
                if (ampm === "pm" && h < 12) h += 12;
                if (ampm === "am" && h === 12) h = 0;
                parsed = true;
            } else {
                const hMatch = timeStr.match(/(\d{1,2})\s*(am|pm)?/i);
                if (hMatch) {
                    h = parseInt(hMatch[1], 10);
                    const ampm = hMatch[2]?.toLowerCase();
                    if (ampm === "pm" && h < 12) h += 12;
                    if (ampm === "am" && h === 12) h = 0;
                    parsed = true;
                }
            }

            if (parsed) {
                start.setHours(h, m, 0);
                end = new Date(start);
                end.setHours(start.getHours() + Math.floor((e.duration || 60) / 60));
                end.setMinutes(start.getMinutes() + ((e.duration || 60) % 60));
            }
        }
        
        const g = groups.find(x => x.id === e.groupId);
        const isLateAndActive = parseEventDate(e.date) < today && String(e.status || "").toLowerCase() !== "submitted" && String(e.status || "").toLowerCase() !== "exported";

        return {
            id: e.id,
            title: g?.name || "Unknown Group",
            locationName: g?.locationName || "",
            start,
            end,
            allDay: !e.time,
            isLateAndActive,
            resource: e
        };
    });

    const submittedEvents = filteredDashboardEvents.filter(e => String(e.status || "").toLowerCase() === "submitted");
    const exportedEvents = filteredDashboardEvents.filter(e => String(e.status || "").toLowerCase() === "exported");
    const cancelledEvents = filteredDashboardEvents.filter(e => String(e.status || "").toLowerCase() === "cancelled");

    const renderEventList = (listEvents: any[]) => {
        if (listEvents.length === 0) return <p className="text-stone-500 italic p-4">No events found.</p>;
        return (
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-stone-50 text-stone-500 border-b border-stone-100 text-xs uppercase font-bold tracking-wider">
                        <tr>
                            <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3">Event Name</th>
                            <th className="px-6 py-3">Status</th>
                            <th className="px-6 py-3 text-center">Stats</th>
                            <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                        {listEvents.map(e => {
                            const group = groups.find(g => g.id === e.groupId);
                            const eventRosters = rosters.filter(r => r.eventId === e.id);
                            const bookedCount = eventRosters.filter(r => r.rsvpStatus === "booked").length;
                            const presentCount = eventRosters.filter(r => r.attendanceStatus === "present").length;
                            const isPast = parseEventDate(e.date) < today;
                            const status = String(e.status || "").toLowerCase();
                            const isExpanded = expandedDashboardEvent === e.id;
                            
                            const d = parseEventDate(e.date);
                            const todayStart = new Date();
                            todayStart.setHours(0, 0, 0, 0);
                            d.setHours(0, 0, 0, 0);
                            const isLateAndActive = d.getTime() < todayStart.getTime() && status !== "submitted" && status !== "exported";

                            return (
                                <React.Fragment key={e.id}>
                                    <tr 
                                        className={`transition-colors cursor-pointer ${isExpanded ? (isLateAndActive ? "bg-rose-50/50" : "bg-stone-50") : "hover:bg-stone-50"} ${isLateAndActive ? "bg-rose-50/30" : ""}`}
                                        onClick={() => setExpandedDashboardEvent(isExpanded ? null : e.id)}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className={`font-semibold ${isLateAndActive ? "text-rose-900" : "text-stone-900"}`}>{e.date}</div>
                                            <div className={`text-[10px] ${isLateAndActive ? "text-rose-600" : "text-stone-500"} uppercase font-bold`}>{formatEventTimeRange(e.time, e.duration, e.title)}</div>
                                        </td>
                                        <td className="px-6 py-4 text-stone-600 font-medium">{group?.name || "Unknown"}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                                isLateAndActive ? "bg-rose-100 text-rose-700 border border-rose-200" :
                                                status === "exported" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                                                status === "submitted" ? "bg-blue-50 text-blue-700 border border-blue-100" :
                                                status === "approved" ? "bg-amber-50 text-stone-900 border border-amber-100" :
                                                isPast ? "bg-stone-100 text-stone-500 border border-stone-200" :
                                                "bg-amber-50 text-amber-700 border border-amber-100"
                                            }`}>
                                                {isLateAndActive ? "late" : (e.status || "pending")}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {isPast ? (
                                                <span className={`font-bold ${isLateAndActive ? "text-rose-700" : "text-emerald-600"}`}>{presentCount} present</span>
                                            ) : (
                                                <span className="text-stone-800 font-bold">{bookedCount} booked</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-2">
                                                <span className="text-stone-400 p-1">
                                                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                                </span>
                                                {status === "submitted" && (
                                                    <button 
                                                        onClick={(ev) => { ev.stopPropagation(); handleExportToInfoodle(e, "Dashboard"); }}
                                                        className="bg-emerald-600 text-white px-3 py-1 rounded-full text-xs font-bold hover:bg-emerald-700 transition shadow-sm flex items-center gap-1"
                                                    >
                                                        <Download className="w-3 h-3" /> Export
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4">
                <h2 className="text-2xl font-bold text-stone-900">Dashboard</h2>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleGenerateEvents}
                        disabled={isGeneratingEvents}
                        className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-2xl font-bold transition flex items-center gap-2 disabled:opacity-50 shadow-sm text-sm"
                    >
                        <CalendarPlus className="w-4 h-4" />
                        {isGeneratingEvents ? "Generating Events..." : "Generate Events"}
                    </button>
                    <button 
                        onClick={() => loadTabData("Dashboard")} 
                        disabled={refreshing}
                        className="text-xs font-bold text-stone-500 hover:text-stone-900 flex items-center gap-1 group bg-stone-100 px-3 py-1.5 rounded-full"
                    >
                        <Clock className={`w-3 h-3 ${refreshing ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`} />
                        {refreshing ? "Refreshing..." : "Refresh"}
                    </button>
                </div>
            </div>

            <div className="flex flex-col md:flex-row md:flex-wrap gap-4 mb-6">
                <div className="flex-1 relative min-w-[250px]">
                    <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-stone-400" />
                    <input 
                        type="text"
                        placeholder="Search events by group or location"
                        value={dashboardSearch}
                        onChange={e => setDashboardSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-500 transition-shadow"
                    />
                </div>
                <select
                    value={dashboardMajorGroupFilter}
                    onChange={(e) => {
                        setDashboardMajorGroupFilter(e.target.value);
                        setDashboardMinorGroupFilter("all");
                    }}
                    className="flex-1 min-w-[150px] bg-white border border-stone-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-stone-500"
                >
                    <option value="all">All Major Groups</option>
                    {groupTypes.map(gt => (
                        <option key={gt.id} value={gt.id}>{gt.longValue || gt.shortValue || "Unnamed Type"}</option>
                    ))}
                </select>
                <select
                    value={dashboardMinorGroupFilter}
                    onChange={(e) => setDashboardMinorGroupFilter(e.target.value)}
                    className="flex-1 min-w-[150px] bg-white border border-stone-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-stone-500"
                >
                    <option value="all">All Minor Groups</option>
                    {groups
                        .filter(g => dashboardMajorGroupFilter === "all" || g.groupTypeId === dashboardMajorGroupFilter)
                        .map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>
                <select
                    value={dashboardLocationFilter}
                    onChange={(e) => {
                        const val = e.target.value;
                        setDashboardLocationFilter(val);
                        localStorage.setItem("adminDashboardLocationFilter", val);
                    }}
                    className="flex-1 min-w-[150px] bg-white border border-stone-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-stone-500"
                >
                    <option value="all">All Locations</option>
                    {Array.from(new Set(groups.map(g => g.locationName).filter(Boolean))).sort().map(loc => (
                        <option key={loc} value={loc}>{loc}</option>
                    ))}
                </select>
            </div>

            <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden p-6 flex flex-col min-h-[600px]">
                <h3 className="font-bold text-stone-800 mb-4 text-xl">Active & Submitted Events Calendar</h3>
                <div 
                    className="flex-1"
                    onClick={(e) => {
                        const target = e.target as HTMLElement;
                        const tr = target.closest("tr[data-event-id]");
                        if (tr) {
                            const eventId = tr.getAttribute("data-event-id");
                            if (eventId) {
                                setExpandedDashboardEvent(eventId);
                            }
                        }
                    }}
                >
                    <BigCalendar
                        localizer={localizer}
                        events={calObjects}
                        startAccessor="start"
                        endAccessor="end"
                        style={{ height: 600 }}
                        eventPropGetter={(event: any) => {
                            if (event.isLateAndActive) {
                                return {
                                    style: {
                                        backgroundColor: "#fee2e2",
                                        borderColor: "#fca5a5",
                                        color: "#9f1239"
                                    }
                                };
                            }
                            return {};
                        }}
                        messages={{
                            event: (
                                <div className="flex flex-row w-full text-left">
                                    <div className="w-5/12">Event</div>
                                    <div className="w-4/12">Location</div>
                                    <div className="w-3/12">Status</div>
                                </div>
                            )
                        }}
                        components={{
                            agenda: {
                                event: CustomAgendaEvent,
                                date: CustomAgendaDate
                            }
                        }}
                        formats={{
                            agendaHeaderFormat: ({ start, end }: { start: Date, end: Date }, culture: any, loc: any) =>
                                loc.format(start, "ddd D MMM YYYY", culture) + " to " + loc.format(end, "ddd D MMM YYYY", culture)
                        }}
                        date={calDate}
                        onNavigate={(date) => setCalDate(date)}
                        view={calView as any}
                        onView={(view) => {
                            setCalView(view);
                            localStorage.setItem("adminCalView", view);
                        }}
                        onSelectEvent={(e) => {
                            setExpandedDashboardEvent(e.id as string);
                            window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                        }}
                        views={["month", "week", "day", "agenda"]}
                        length={Math.max(30, Math.ceil((new Date().getTime() - calDate.getTime()) / (1000 * 3600 * 24)) + 30)}
                    />
                </div>
            </div>
            
            {expandedDashboardEvent && (
                (() => {
                    const expandedEv = filteredDashboardEvents.find(e => e.id === expandedDashboardEvent);
                    if (expandedEv) {
                        const group = groups.find(g => g.id === expandedEv.groupId);
                        const timeStr = formatEventTimeRange(expandedEv.time, expandedEv.duration, expandedEv.title);
                        const todayDate = new Date();
                        todayDate.setHours(0, 0, 0, 0);
                        const eventDate = parseEventDate(expandedEv.date);
                        eventDate.setHours(0, 0, 0, 0);
                        const isLateAndActive = eventDate.getTime() < todayDate.getTime() && String(expandedEv.status || "pending").toLowerCase() !== "submitted" && String(expandedEv.status || "pending").toLowerCase() !== "exported";
                        
                        return (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                                <div className="bg-stone-100 rounded-3xl border border-stone-200 shadow-2xl overflow-hidden w-[90vw] max-w-[1800px] max-h-[95vh] flex flex-col relative">
                                    <div className={`flex justify-between items-start p-6 border-b border-stone-200/60 sticky top-0 z-10 w-full gap-4 ${isLateAndActive ? "bg-rose-50" : "bg-white"}`}>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-col gap-1.5 w-full pr-4">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <h2 className={`text-xl font-bold leading-tight ${isLateAndActive ? "text-rose-900" : "text-stone-900"}`}>{group?.name || "Unknown Group"}</h2>
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider inline-block shrink-0 ${
                                                        isLateAndActive ? "bg-rose-100 text-rose-700 border border-rose-200" :
                                                        String(expandedEv.status || "pending").toLowerCase() === "exported" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                                                        String(expandedEv.status || "pending").toLowerCase() === "submitted" ? "bg-blue-50 text-blue-700 border border-blue-100" :
                                                        String(expandedEv.status || "pending").toLowerCase() === "approved" ? "bg-amber-50 text-stone-900 border border-amber-100" :
                                                        "bg-amber-50 text-amber-700 border border-amber-100"
                                                    }`}>
                                                        {isLateAndActive ? "late" : (expandedEv.status || "pending")}
                                                    </span>
                                                </div>
                                                <div className="text-stone-600 font-semibold text-sm flex flex-wrap items-center gap-1.5">
                                                    <span>{timeStr}</span>
                                                    <span className="text-stone-300">•</span>
                                                    <span>{moment(parseEventDate(expandedEv.date)).format("ddd D MMMM YYYY")}</span>
                                                </div>
                                                <div className="text-stone-500 font-medium text-sm flex items-center gap-1.5">
                                                    <MapPin className="w-3.5 h-3.5 text-stone-400" />
                                                    <span>{group?.locationName || "Location Not Specified"}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <button 
                                            autoFocus
                                            onClick={() => setExpandedDashboardEvent(null)}
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

            <div className="space-y-4">
                <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                    <button 
                        onClick={() => setExpandedSubmitted(!expandedSubmitted)}
                        className="w-full p-4 flex justify-between items-center bg-blue-50/30 hover:bg-blue-50/50 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-bold">{submittedEvents.length}</span>
                            <h3 className="font-bold text-stone-800 text-lg">Submitted Events</h3>
                            <span className="text-stone-500 text-sm">Ready for Export</span>
                        </div>
                        {expandedSubmitted ? <ChevronDown className="w-5 h-5 text-stone-400" /> : <ChevronRight className="w-5 h-5 text-stone-400" />}
                    </button>
                    {expandedSubmitted && renderEventList(submittedEvents)}
                </div>

                <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                    <button 
                        onClick={() => setExpandedExported(!expandedExported)}
                        className="w-full p-4 flex justify-between items-center bg-emerald-50/30 hover:bg-emerald-50/50 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-sm font-bold">{exportedEvents.length}</span>
                            <h3 className="font-bold text-stone-800 text-lg">Exported Events</h3>
                            <span className="text-stone-500 text-sm">Successfully processed</span>
                        </div>
                        {expandedExported ? <ChevronDown className="w-5 h-5 text-stone-400" /> : <ChevronRight className="w-5 h-5 text-stone-400" />}
                    </button>
                    {expandedExported && renderEventList(exportedEvents)}
                </div>

                <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                    <button 
                        onClick={() => setExpandedCancelled(!expandedCancelled)}
                        className="w-full p-4 flex justify-between items-center bg-stone-50/50 hover:bg-stone-100 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <span className="bg-stone-200 text-stone-700 px-3 py-1 rounded-full text-sm font-bold">{cancelledEvents.length}</span>
                            <h3 className="font-bold text-stone-800 text-lg">Cancelled Events</h3>
                        </div>
                        {expandedCancelled ? <ChevronDown className="w-5 h-5 text-stone-400" /> : <ChevronRight className="w-5 h-5 text-stone-400" />}
                    </button>
                    {expandedCancelled && renderEventList(cancelledEvents)}
                </div>
            </div>
        </div>
    );
};
