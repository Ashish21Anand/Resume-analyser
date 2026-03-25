const { GoogleGenAI } = require("@google/genai")
const { z } = require("zod")
const { zodToJsonSchema } = require("zod-to-json-schema")
const puppeteer = require("puppeteer")

const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_GENAI_API_KEY
})


const interviewReportSchema = z.object({
    matchScore: z.number().describe("A score between 0 and 100 indicating how well the candidate's profile matches the job describe"),
    technicalQuestions: z.array(z.object({
        question: z.string().describe("The technical question can be asked in the interview"),
        intention: z.string().describe("The intention of interviewer behind asking this question"),
        answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
    })).describe("Technical questions that can be asked in the interview along with their intention and how to answer them"),
    behavioralQuestions: z.array(z.object({
        question: z.string().describe("The technical question can be asked in the interview"),
        intention: z.string().describe("The intention of interviewer behind asking this question"),
        answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
    })).describe("Behavioral questions that can be asked in the interview along with their intention and how to answer them"),
    skillGaps: z.array(z.object({
        skill: z.string().describe("The skill which the candidate is lacking"),
        severity: z.enum([ "low", "medium", "high" ]).describe("The severity of this skill gap, i.e. how important is this skill for the job and how much it can impact the candidate's chances")
    })).describe("List of skill gaps in the candidate's profile along with their severity"),
    preparationPlan: z.array(z.object({
        day: z.number().describe("The day number in the preparation plan, starting from 1"),
        focus: z.string().describe("The main focus of this day in the preparation plan, e.g. data structures, system design, mock interviews etc."),
        tasks: z.array(z.string()).describe("List of tasks to be done on this day to follow the preparation plan, e.g. read a specific book or article, solve a set of problems, watch a video etc.")
    })).describe("A day-wise preparation plan for the candidate to follow in order to prepare for the interview effectively"),
    title: z.string().describe("The title of the job for which the interview report is generated"),
})

async function generateInterviewReport({ resume, selfDescription, jobDescription }) {


    const prompt = `Generate an interview report for a candidate with the following details:
                        Resume: ${resume}
                        Self Description: ${selfDescription}
                        Job Description: ${jobDescription}
`

    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: zodToJsonSchema(interviewReportSchema),
        }
    })

    return JSON.parse(response.text)


}



function buildPuppeteerLaunchOptions() {
    const launchOptions = {
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu"
        ]
    }

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
    }

    return launchOptions
}

function normalizeHtmlDocument(htmlContent) {
    if (htmlContent.trim().toLowerCase().startsWith("<!doctype html")) {
        return htmlContent
    }

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Resume</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: Arial, sans-serif;
            color: #111827;
        }
    </style>
</head>
<body>
    ${htmlContent}
</body>
</html>`
}

function escapePdfText(value) {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
}

function decodeHtmlEntities(value) {
    return value
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
}

function htmlToPlainText(htmlContent) {
    return decodeHtmlEntities(
        htmlContent
            .replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, "\n")
            .replace(/<li[^>]*>/gi, "- ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\r/g, "")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/[ \t]{2,}/g, " ")
    ).trim()
}

function buildPdfBufferFromText(textContent) {
    const pageWidth = 595
    const pageHeight = 842
    const left = 50
    const top = 790
    const lineHeight = 16
    const maxCharsPerLine = 88
    const paragraphs = textContent.split("\n")
    const wrappedLines = []

    for (const paragraph of paragraphs) {
        const normalizedParagraph = paragraph.trim()

        if (!normalizedParagraph) {
            wrappedLines.push("")
            continue
        }

        let currentLine = ""
        for (const word of normalizedParagraph.split(/\s+/)) {
            const candidate = currentLine ? `${currentLine} ${word}` : word
            if (candidate.length > maxCharsPerLine) {
                if (currentLine) {
                    wrappedLines.push(currentLine)
                }
                currentLine = word
            } else {
                currentLine = candidate
            }
        }

        if (currentLine) {
            wrappedLines.push(currentLine)
        }
    }

    const linesPerPage = 45
    const pages = []
    for (let i = 0; i < wrappedLines.length; i += linesPerPage) {
        pages.push(wrappedLines.slice(i, i + linesPerPage))
    }

    if (pages.length === 0) {
        pages.push([ "Resume content unavailable." ])
    }

    const objects = [ null, null ]
    const addObject = (content) => {
        objects.push(content)
        return objects.length
    }

    const fontObjectId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    const pageObjectIds = []

    for (const pageLines of pages) {
        let contentStream = `BT\n/F1 11 Tf\n${left} ${top} Td\n`

        pageLines.forEach((line, index) => {
            if (index > 0) {
                contentStream += `0 -${lineHeight} Td\n`
            }

            contentStream += `(${escapePdfText(line)}) Tj\n`
        })

        if (pageLines.length === 0) {
            contentStream += "(Resume content unavailable.) Tj\n"
        }

        contentStream += "ET"

        const contentObjectId = addObject(`<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream`)
        const pageObjectId = addObject(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`)
        pageObjectIds.push(pageObjectId)
    }

    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`

    let pdf = "%PDF-1.4\n"
    const offsets = [ 0 ]

    objects.forEach((objectContent, index) => {
        offsets.push(Buffer.byteLength(pdf, "utf8"))
        pdf += `${index + 1} 0 obj\n${objectContent}\nendobj\n`
    })

    const xrefOffset = Buffer.byteLength(pdf, "utf8")
    pdf += `xref\n0 ${objects.length + 1}\n`
    pdf += "0000000000 65535 f \n"

    for (let i = 1; i < offsets.length; i++) {
        pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
    }

    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

    return Buffer.from(pdf, "utf8")
}

function buildLocalResumeText({ resume, selfDescription, jobDescription }) {
    const safeResume = resume?.trim()
    const safeSelfDescription = selfDescription?.trim()
    const safeJobDescription = jobDescription?.trim()

    return [
        "Generated Resume",
        "",
        "Professional Summary",
        safeSelfDescription || "Candidate profile summary was not provided.",
        "",
        "Relevant Background",
        safeResume || "Resume content was not available, so this section was generated from the available profile details.",
        "",
        "Target Role Notes",
        safeJobDescription || "Target job description was not available."
    ].join("\n")
}

async function generatePdfFromHtml(htmlContent) {
    const browser = await puppeteer.launch(buildPuppeteerLaunchOptions())

    try {
        const page = await browser.newPage()
        await page.setContent(normalizeHtmlDocument(htmlContent), { waitUntil: "domcontentloaded" })
        await page.emulateMediaType("screen")

        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "20mm",
                bottom: "20mm",
                left: "15mm",
                right: "15mm"
            }
        })

        return pdfBuffer
    } finally {
        await browser.close()
    }
}

async function generateResumePdf({ resume, selfDescription, jobDescription }) {

    const resumePdfSchema = z.object({
        html: z.string().describe("The HTML content of the resume which can be converted to PDF using any library like puppeteer")
    })

    const prompt = `Generate resume for a candidate with the following details:
                        Resume: ${resume}
                        Self Description: ${selfDescription}
                        Job Description: ${jobDescription}

                        the response should be a JSON object with a single field "html" which contains the HTML content of the resume which can be converted to PDF using any library like puppeteer.
                        The resume should be tailored for the given job description and should highlight the candidate's strengths and relevant experience. The HTML content should be well-formatted and structured, making it easy to read and visually appealing.
                        The content of resume should be not sound like it's generated by AI and should be as close as possible to a real human-written resume.
                        you can highlight the content using some colors or different font styles but the overall design should be simple and professional.
                        The content should be ATS friendly, i.e. it should be easily parsable by ATS systems without losing important information.
                        The resume should not be so lengthy, it should ideally be 1-2 pages long when converted to PDF. Focus on quality rather than quantity and make sure to include all the relevant information that can increase the candidate's chances of getting an interview call for the given job description.
                    `

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: zodToJsonSchema(resumePdfSchema),
            }
        })

        const jsonContent = JSON.parse(response.text)
        return await generatePdfFromHtml(jsonContent.html)
    } catch (error) {
        console.error("Resume generation failed, falling back to local PDF:", error)

        return buildPdfBufferFromText(
            buildLocalResumeText({ resume, selfDescription, jobDescription })
        )
    }

}

module.exports = { generateInterviewReport, generateResumePdf }
