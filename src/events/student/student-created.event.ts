export interface StudentCreatedEvent {
    eventId: string;
    eventType: "student.created";
    tenantId: string;

    occurredAt: string; // ISO date
    actor: {
        userId: string;
        role: "admin" | "teacher" | "system";
    };

    student: {
        studentId: string;
        admissionNo: string;
        fullName: string;
        gender?: "male" | "female" | "other";
        dob?: string;
        gradeId?: string;
    };

    source: {
        service: "school-api";
        version: "1.0";
    };
}
