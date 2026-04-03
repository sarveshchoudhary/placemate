import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: "ap-south-1", // Mumbai
});

export const sendEmail = async (to, subject, message) => {
  try {
    const params = {
      Source: "asrveshchoudhary102@gmail.com", // VERIFIED EMAIL
      Destination: {
        ToAddresses: [to],
      },
      Message: {
        Subject: {
          Data: subject,
        },
        Body: {
          Text: {
            Data: message,
          },
        },
      },
    };

    const command = new SendEmailCommand(params);
    await ses.send(command);

    console.log("Email sent successfully");

  } catch (error) {
    console.error("SES ERROR:", error);
  }
};