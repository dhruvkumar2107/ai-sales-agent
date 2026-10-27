import { useAuth } from "@/lib/auth";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const { user, isLoading } = useAuth();

  if (isLoading || !user) {
    return <div>Loading...</div>;
  }

  // Sample data - in production this would come from Firestore
  const [leads, setLeads] = useState<any[]>([
    { id: "1", name: "Rahul Sharma", phone: "+919845012345", stage: "new", score: "hot", source: "website", model: "Hyundai Creta", assignedTo: "exec_1" },
    { id: "2", name: "Priya Patel", phone: "+919845012346", stage: "contacted", score: "warm", source: "facebook", model: "Honda Shine 125", assignedTo: "exec_2" },
    { id: "3", name: "Amit Kumar", phone: "+919845012347", stage: "test_drive_booked", score: "hot", source: "inbound_call", model: "Hyundai Venue", assignedTo: "exec_1" },
    { id: "4", name: "Suresh Menon", phone: "+919845012348", stage: "negotiation", score: "warm", source: "walk_in", model: "Honda Unicorn", assignedTo: "exec_2" },
    { id: "5", name: "Kavita Singh", phone: "+919845012349", stage: "won", score: "hot", source: "inbound_call", model: "Hyundai Creta", assignedTo: "exec_1" },
  ]);

  const stages = ["new", "contacted", "test_drive_booked", "negotiation", "won", "lost"];

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border/50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3 1.34-3 3-3zM12 9c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34 3-3zm6 9c-.58-.26-1.1-.56-1.43-.93l-3.26 1.86c-.08-.33-.16-.67-.19-1.02l.55-3.71c.05-.41.04-.83.05-1.25l-4.76-1.86c-.35-.19-.77-.1--1.02.18L15 21l2.89-6.55c.33-.76.09-1.2-.43-1.33l-3.43-.68c-.39-.07-1.02-.05-1.43.03L12 14z"/>
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold">AXO Voice Auto</h2>
                <p className="text-sm text-muted-foreground">Dealership Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Welcome, {user.name}</span>
              <button onClick={() => {} } className="hidden sm:inline-flex px-3 py-1.5 rounded-lg text-sm font-medium bg-primary/10 text-primary">
                Profile
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Leads Stats Card */}
          <div className="rounded-lg border border-border/50 p-6 bg-card">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Leads Overview</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-3xl font-bold text-primary">{leads.length}</p>
                <p className="text-sm text-muted-foreground">Total Leads</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-success">3</p>
                <p className="text-sm text-muted-foreground">Hot</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-warning">2</p>
                <p className="text-sm text-muted-foreground">Warm</p>
              </div>
            </div>
          </div>

          {/* Conversion Card */}
          <div className="rounded-lg border border-border/50 p-6 bg-card">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Conversion</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-2xl font-medium">25%</p>
                <p className="text-xs text-muted-foreground">Enquiry→Test Drive</p>
              </div>
              <div>
                <p className="text-2xl font-medium">15%</p>
                <p className="text-xs text-muted-foreground">Test Drive→Sale</p>
              </div>
            </div>
          </div>
        </div>

        {/* Leads Kanban Board */}
        <div className="rounded-lg border border-border/50 p-6 bg-card">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Leads Board</h3>
          <div className="space-y-4">
            {stages.map((stage) => {
              const stageLeads = leads.filter((lead) => lead.stage === stage);
              return (
                <div key={stage} className="p-4 rounded-lg border bg-card/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{stage}</span>
                    <span className="text-xs text-muted-foreground">{stageLeads.length}</span>
                  </div>
                  <ul className="space-y-1">
                    {stageLeads.map((lead) => (
                      <li key={lead.id} className="text-sm p-1 rounded border border-border/20 hover:bg-primary/5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-{lead.score === 'hot' ? 'primary' : lead.score === 'warm' ? 'warning' : 'muted-foreground'}"></span>
                          <span className="truncate max-w-xs">{lead.name}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}