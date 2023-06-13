const dotenv = require("dotenv")
const { Client, APIResponseError } = require("@notionhq/client")
const twilio = require('twilio')

dotenv.config()
const notionClient = new Client({
    auth: process.env.NOTION_AUTH_TOKEN
})
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_ACCOUNT_TOKEN)

const _extractSubscriptionDetails = async (filteredSubscriptionsArray) => {
    let details

    if(filteredSubscriptionsArray) {
        const neededPageAndPropertiesIds= filteredSubscriptionsArray.map((subscriptionObject) => ({
            pageId: subscriptionObject.id,
            renewalDatePropertyId: subscriptionObject.properties['Renewal Date'].id,
            namePropertyId: subscriptionObject.properties['Name'].id,
            billingPropertyId: subscriptionObject.properties['Billing'].id,
            costsPropertyId: subscriptionObject.properties['Costs'].id
        }))

        const promises = neededPageAndPropertiesIds.map(async (pageAndPropertiesIdsObj) => {
            const { pageId, renewalDatePropertyId, namePropertyId, billingPropertyId, costsPropertyId } = pageAndPropertiesIdsObj;
            const renewalDatePropertyDetails = await notionClient.pages.properties.retrieve({
                page_id: pageId,
                property_id: renewalDatePropertyId
            })

            const namePropertyDetails = await notionClient.pages.properties.retrieve({
                page_id: pageId,
                property_id: namePropertyId
            })

            const billingPropertyDetails = await notionClient.pages.properties.retrieve({
                page_id: pageId,
                property_id: billingPropertyId
            })

            const costsPropertyDetails = await notionClient.pages.properties.retrieve({
                page_id: pageId,
                property_id: costsPropertyId
            })

            return {
                renewalDate: renewalDatePropertyDetails.date.start,
                cost: costsPropertyDetails.number,
                billingType: billingPropertyDetails.select.name,
                subscription: namePropertyDetails.results[0]?.title.text.content
            }
        })

        details = await Promise.all(promises)
    }
    else {
        throw new Error('You did not provide any array to extract data from.')
    }

    return details
}

const _generateTwiMLInstructions = (details) => {
    let message = `<Response><Say>You have ${ details.length } upcoming subscription payments tomorrow.`
    details.forEach((detail, index) => {
        message = `${ message } ${ index+1 }, ${ detail.billingType } ${ detail.subscription } online subscription payment of ${ detail.cost }.`
    })
    message = `${ message } </Say></Response>`
    return message
}

(async () => {
    const notifyMeOn = new Date()
    notifyMeOn.setDate(notifyMeOn.getDate() + 1)
    notifyMeOn.toISOString()

    try {
        const response = await notionClient.databases.query({
            database_id: process.env.NOTION_DATABASE_ID,
            filter: {
                property: "Renewal Date",
                date: {
                    before: notifyMeOn,
                },
            },
        })

        const details = await _extractSubscriptionDetails(response.results);
        if(details.length > 0) {
            const message = _generateTwiMLInstructions(details)
            twilioClient.calls
            .create({
                twiml: message,
                to: process.env.PHONE_NUMBER_FOR_NOTIFICATIONS,
                from: process.env.TWILIO_PHONE_NUMBER
            })
            .then(call => console.log(call.sid))
            .catch((error) => {
                console.error('An error occured from the Twilio client.' + error)
            });
        } 
    } catch (error) {
        if (error instanceof APIResponseError) {
            console.error("Unable to fetch items from database. An error was raised by the API client.")
            console.error("Error code: " + error.code)
            console.error(error.message)
        } else {
            console.error(error.message)
        }
    }
})()
