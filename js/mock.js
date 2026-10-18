// Pregnancy Care Tracker — mock backend.
// Used when js/config.js has MOCK: true, so the UI can be built and tested
// with no Apps Script deployment. Shapes match the real backend's actions
// in backend/Code.gs — keep the two in sync as new actions are added.

function todayPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const mockSettings = {
  due_date: todayPlusDays(90),
  lmp_date: "",
  wife_name: "Priya",
  blood_group: "O+",
  allergies: "Penicillin",
  hospital_name: "City Women's Hospital",
  hospital_phone: "+91 90000 00000",
  hospital_address: "12 MG Road, Hyderabad",
  insurance_info: "",
  language: "en"
};

const mockState = {
  settings: { ...mockSettings }
};

function mockDashboard() {
  const due = new Date(mockState.settings.due_date);
  const today = new Date();
  const lmp = new Date(due.getTime());
  lmp.setDate(lmp.getDate() - 280);
  const daysSinceLmp = Math.max(0, Math.round((today - lmp) / 86400000));
  const daysLeft = Math.round((due - today) / 86400000);

  return {
    due_date: mockState.settings.due_date,
    lmp_date: mockState.settings.lmp_date,
    gestational_age: {
      weeks: Math.floor(daysSinceLmp / 7),
      days: daysSinceLmp % 7,
      trimester: daysSinceLmp < 13 * 7 ? 1 : daysSinceLmp < 28 * 7 ? 2 : 3,
      days_left: daysLeft
    },
    next_appointment: {
      id: "mock-1",
      datetime: new Date(today.getTime() + 5 * 86400000).toISOString(),
      doctor: "Dr. Rao",
      purpose: "Routine checkup",
      location: "City Women's Hospital"
    },
    today_medicines: [
      { medicine_id: "mock-med-1", name: "Folic acid", dose: "5mg", time: "08:00" },
      { medicine_id: "mock-med-2", name: "Iron", dose: "1 tablet", time: "20:00" }
    ],
    latest_vitals: {
      date: todayPlusDays(-2),
      weight_kg: 62,
      bp_sys: 112,
      bp_dia: 74,
      sugar_fasting: 88,
      sugar_pp: 120,
      kicks: 12,
      mood: "Good"
    }
  };
}

export async function mockCall(action, payload) {
  // Simulate real network latency so loading states are visible in dev.
  await new Promise((resolve) => setTimeout(resolve, 300));

  switch (action) {
    case "auth.check":
      return { authenticated: true };
    case "settings.get":
      return { ...mockState.settings };
    case "settings.set":
      mockState.settings = { ...mockState.settings, ...payload };
      return { ...mockState.settings };
    case "dashboard.get":
      return mockDashboard();
    default:
      throw new Error("Mock backend: unknown action " + action);
  }
}
