import { ToolCall, ToolDefinition, ToolResult } from "../core/types";
import { BaseService } from "./BaseService";

/**
 * CalendarService exposes calendar management capabilities to the LLM.
 *
 * Tools provided: `get_events`, `create_event`
 */
export class CalendarService extends BaseService {
  readonly name = "CalendarService";

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "get_events",
        description: "Retrieve calendar events within a specified date range.",
        parameters: {
          type: "object",
          properties: {
            startDate: {
              type: "string",
              description: "Start of the date range in ISO 8601 format (e.g. 2024-01-01).",
            },
            endDate: {
              type: "string",
              description: "End of the date range in ISO 8601 format (e.g. 2024-01-31).",
            },
            calendarId: {
              type: "string",
              description: "Optional ID of a specific calendar to query. Defaults to the primary calendar.",
            },
          },
          required: ["startDate", "endDate"],
        },
      },
      {
        name: "create_event",
        description: "Create a new calendar event.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Title of the event.",
            },
            startTime: {
              type: "string",
              description: "Start time of the event in ISO 8601 format.",
            },
            endTime: {
              type: "string",
              description: "End time of the event in ISO 8601 format.",
            },
            description: {
              type: "string",
              description: "Optional description or notes for the event.",
            },
            location: {
              type: "string",
              description: "Optional location for the event.",
            },
          },
          required: ["title", "startTime", "endTime"],
        },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    switch (call.toolName) {
      case "get_events": {
        const { startDate, endDate, calendarId } = call.arguments as {
          startDate: string;
          endDate: string;
          calendarId?: string;
        };

        // Mock implementation — replace with a real calendar API call.
        const mockEvents = [
          {
            id: "evt-001",
            title: "Team Standup",
            startTime: `${startDate}T09:00:00Z`,
            endTime: `${startDate}T09:30:00Z`,
            calendarId: calendarId ?? "primary",
          },
          {
            id: "evt-002",
            title: "Product Review",
            startTime: `${endDate}T14:00:00Z`,
            endTime: `${endDate}T15:00:00Z`,
            calendarId: calendarId ?? "primary",
          },
        ];

        return {
          success: true,
          output: { startDate, endDate, events: mockEvents },
        };
      }

      case "create_event": {
        const { title, startTime, endTime, description, location } =
          call.arguments as {
            title: string;
            startTime: string;
            endTime: string;
            description?: string;
            location?: string;
          };

        // Mock implementation — replace with a real calendar API call.
        const newEvent = {
          id: `evt-${Date.now()}`,
          title,
          startTime,
          endTime,
          description: description ?? "",
          location: location ?? "",
        };

        return {
          success: true,
          output: { created: true, event: newEvent },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${call.toolName}` };
    }
  }
}
