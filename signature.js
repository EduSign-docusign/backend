const twilio = require("twilio");
const schedule = require("node-schedule");

class SignatureChecker {
  constructor(firestore, twilioConfig) {
    this.db = firestore;
    this.twilioClient = twilio(twilioConfig.accountSid, twilioConfig.authToken);
    this.twilioPhoneNumber = twilioConfig.phoneNumber;

    // Start scheduled job
    this.initializeScheduler();
  }

  // Initialize daily check schedule
  initializeScheduler() {
    // Run every day at 2 PM
    schedule.scheduleJob("0 14 * * *", () => this.checkSignaturesAndCall());
  }

  // Send SMS to parent
  async sendParentSMS(parentPhone, studentName, courseName, dueDate) {
    try {
        // Ensure phone number is in E.164 format
        const formattedPhone = parentPhone.startsWith('+') 
            ? parentPhone 
            : `+1${parentPhone.replace(/\D/g, '')}`;

        // Convert Firestore Timestamp to JavaScript Date (unix to words)
        dueDate = Date(dueDate);

        // Convert to words
        const dueDateObj = dueDate.toDate ? dueDate.toDate() : new Date(dueDate);

        // Check if the date is valid
        if (isNaN(dueDateObj.getTime())) {
            console.error('Invalid date:', dueDate);
            throw new Error('Invalid date format');
        }

        const formattedDate = dueDateObj.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });

        const message = await this.twilioClient.messages.create({
            body: `Reminder: ${studentName}'s permission slip for ${courseName} is due by ${formattedDate}. Please sign it. Thank you!`,
            from: this.twilioPhoneNumber,
            to: formattedPhone,
        });

        console.log(JSON.stringify(message))

        console.log(`Successfully sent SMS to parent of ${studentName} at ${formattedPhone}`);
        return true;
    } catch (error) {
        console.error('Date details:', {
            originalDueDate: dueDate,
            originalType: typeof dueDate,
            convertedDate: dueDate.toDate ? dueDate.toDate() : new Date(dueDate),
            isValidDate: dueDate.toDate ? !isNaN(dueDate.toDate().getTime()) : !isNaN(new Date(dueDate).getTime())
        });

        console.error(`Failed to send SMS to parent of ${studentName}:`, error);
        return false;
    }
}

  // Make phone call to parent
  async makeParentCall(parentPhone, studentName, courseName, dueDate) {
    try {
        // Ensure phone number is in E.164 format
        const formattedPhone = parentPhone.startsWith('+') 
            ? parentPhone 
            : `+1${parentPhone.replace(/\D/g, '')}`;

        // Convert Firestore Timestamp to JavaScript Date (unix to words)
        dueDate = Date(dueDate);

        // Convert to words
        const dueDateObj = dueDate.toDate ? dueDate.toDate() : new Date(dueDate);

        // Check if the date is valid
        if (isNaN(dueDateObj.getTime())) {
            console.error('Invalid date:', dueDate);
            throw new Error('Invalid date format');
        }

        const formattedDate = dueDateObj.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });

        await this.twilioClient.calls.create({
            twiml: `<Response>
                <Say voice="Polly.Salli">
                    Hello, this is an automatic reminder from EduSign regarding ${studentName}'s permission slip 
                    for ${courseName}. The document requires both student and parent signatures, and is due 
                    by ${formattedDate}. Please check your email to sign the document. Thank you.
                </Say>
                <Pause length="1"/>
                <Say voice="Polly.Salli">
                    To repeat: This is regarding ${studentName}'s permission slip which needs signatures
                    and is due ${formattedDate}. Thank you for your attention.
                </Say>
            </Response>`,
            to: formattedPhone,
            from: this.twilioPhoneNumber
        });

        console.log(`Successfully called parent of ${studentName} at ${formattedPhone}`);
        return true;
    } catch (error) {
        console.error('Date details:', {
            originalDueDate: dueDate,
            originalType: typeof dueDate,
            convertedDate: dueDate.toDate ? dueDate.toDate() : new Date(dueDate),
            isValidDate: dueDate.toDate ? !isNaN(dueDate.toDate().getTime()) : !isNaN(new Date(dueDate).getTime())
        });

        console.error(`Failed to call parent of ${studentName}:`, error);
        return false;
    }
}

  // Check document signatures and trigger calls and SMS
  async checkSignaturesAndCall() {
    const now = new Date();
    const twoDaysFromNow = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    try {
      // Get documents due within next 48 hours
      const documentsSnapshot = await this.db
        .collection("documents")
        .where("due_date", ">", now)
        .where("due_date", "<", twoDaysFromNow)
        .get();

      const callResults = [];

      for (const doc of documentsSnapshot.docs) {
        const documentData = doc.data();

        // Process each envelope in the document
        for (const envelope of documentData.docusign_envelopes || []) {
          if (!envelope.studentHasSigned || !envelope.parentHasSigned) {
            // Get student information
            const studentSnapshot = await this.db
              .collection("users")
              .where("name", "==", envelope.name)
              .limit(1)
              .get();

            if (!studentSnapshot.empty) {
              const studentData = studentSnapshot.docs[0].data();

              // Only proceed if parent has phone number
              if (studentData.parentPhone) {
                const callSuccessful = await this.makeParentCall(
                  studentData.parentPhone,
                  studentData.name,
                  documentData.course_name,
                  documentData.due_date
                );

                const smsSuccessful = await this.sendParentSMS(
                  studentData.parentPhone,
                  studentData.name,
                  documentData.course_name,
                  documentData.due_date
                );

                callResults.push({
                  studentName: studentData.name,
                  callSuccess: callSuccessful,
                  smsSuccess: smsSuccessful,
                  timestamp: new Date(),
                  documentId: doc.id,
                });

                // Log the call attempt in Firestore
                await this.logCallAttempt(doc.id, {
                  studentName: studentData.name,
                  parentPhone: studentData.parentPhone,
                  callSuccess: callSuccessful,
                  smsSuccess: smsSuccessful,
                  timestamp: new Date(),
                });

                // Wait 2 seconds between calls to avoid rate limiting
                await new Promise((resolve) => setTimeout(resolve, 2000));
              }
            }
          }
        }
      }

      return callResults;
    } catch (error) {
      console.error("Error in checkSignaturesAndCall:", error);
      throw error;
    }
  }

  // Log call attempts to Firestore
  async logCallAttempt(documentId, callData) {
    try {
      await this.db
        .collection("documents")
        .doc(documentId)
        .collection("call_logs")
        .add({
          ...callData,
          created_at: new Date(),
        });
    } catch (error) {
      console.error("Error logging call attempt:", error);
    }
  }

  // Manual trigger for reminder calls to PARENT for all students in a specific document
  async triggerReminderCalls(documentId) {
    try {
      const doc = await this.db.collection("documents").doc(documentId).get();

      if (!doc.exists) {
        throw new Error("Document not found");
      }

      const documentData = doc.data();
      const callResults = [];

      console.log("Document Data:", documentData); // Debug log
      console.log("Envelopes:", documentData.docusign_envelopes); // Debug log

      for (const envelope of documentData.docusign_envelopes || []) {
        console.log("Processing envelope:", envelope); // Debug log

        if (!envelope.studentHasSigned || !envelope.parentHasSigned) {
          const studentSnapshot = await this.db
            .collection("users")
            .where("name", "==", envelope.name)
            .limit(1)
            .get();

          console.log("Student Snapshot Empty:", studentSnapshot.empty); // Debug log

          if (!studentSnapshot.empty) {
            const studentData = studentSnapshot.docs[0].data();

            console.log("Student Data:", studentData); // Debug log

            if (studentData.parentPhone) {
              console.log("Attempting to call:", studentData.parentPhone); // Debug log

              try {
                const callSuccessful = await this.makeParentCall(
                  studentData.parentPhone,
                  studentData.name,
                  documentData.course_name,
                  documentData.due_date
                );

                const smsSuccessful = await this.sendParentSMS(
                  studentData.parentPhone,
                  studentData.name,
                  documentData.course_name,
                  documentData.due_date
                );

                callResults.push({
                  studentName: studentData.name,
                  callSuccess: callSuccessful,
                  smsSuccess: smsSuccessful,
                  timestamp: new Date(),
                  parentPhone: studentData.parentPhone,
                });

                await this.logCallAttempt(documentId, {
                  studentName: studentData.name,
                  parentPhone: studentData.parentPhone,
                  callSuccess: callSuccessful,
                  smsSuccess: smsSuccessful,
                  timestamp: new Date(),
                });

                // Wait 2 seconds between calls
                await new Promise((resolve) => setTimeout(resolve, 2000));
              } catch (callError) {
                console.error("Call Error:", callError);
                callResults.push({
                  studentName: studentData.name,
                  success: false,
                  error: callError.message,
                  timestamp: new Date(),
                  parentPhone: studentData.parentPhone,
                });
              }
            } else {
              console.log(`No parent phone for ${envelope.name}`);
            }
          } else {
            console.log(`No student found for name: ${envelope.name}`);
          }
        }
      }

      return callResults;
    } catch (error) {
      console.error("Error in triggerReminderCalls:", error);
      throw error;
    }
  }
}

module.exports = SignatureChecker;
