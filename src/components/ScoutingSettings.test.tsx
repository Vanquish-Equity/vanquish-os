// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ScoutingSettings from "./ScoutingSettings";
import { configureCompanyScouting, scanMailboxNow } from "@/lib/scouting/actions";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/lib/scouting/actions",()=>({configureCompanyScouting:vi.fn(),scanMailboxNow:vi.fn(),setContactMode:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("requires explicit member opt-in and retains the manual scan",async()=>{
 vi.mocked(configureCompanyScouting).mockResolvedValue({ok:true,message:"Enabled."});
 vi.mocked(scanMailboxNow).mockResolvedValue({ok:true,message:"Scan complete."});
 render(<ScoutingSettings contactMode="request" lastScannedAt={null} googleConnected backgroundAvailable backgroundEnabled={false}/>);
 const toggle=screen.getByRole("checkbox",{name:"Scan my mailbox for new companies in the background"}) as HTMLInputElement;
 expect(toggle.checked).toBe(false);expect(configureCompanyScouting).not.toHaveBeenCalled();expect(scanMailboxNow).not.toHaveBeenCalled();
 fireEvent.click(toggle);await waitFor(()=>expect(screen.getByRole("status").textContent).toBe("Enabled."));expect(configureCompanyScouting).toHaveBeenCalledWith(true);
 fireEvent.click(await screen.findByRole("button",{name:"Scan now"}));await waitFor(()=>expect(scanMailboxNow).toHaveBeenCalledTimes(1));
});
it("does not offer opt-in before its migration or without Google",()=>{
 const ui=render(<ScoutingSettings contactMode="request" lastScannedAt={null} googleConnected/>);
 expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
 ui.rerender(<ScoutingSettings contactMode="request" lastScannedAt={null} googleConnected={false} backgroundAvailable/>);
 expect(screen.queryByRole("checkbox")).toBeNull();
});
