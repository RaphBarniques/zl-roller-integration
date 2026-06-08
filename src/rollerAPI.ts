//Todo: Implement retry and refresh logic (see ZL API)
import { RollerAuthToken } from "./rollerAuth.ts";

export async function getCustomerEmail(customerID:string){
    
    const response = await fetch(
        `https://api.play.roller.app/guests/${customerID}`,
        {
            headers: {
                Accept: 'application/json',
                'Authorization': `Bearer ${RollerAuthToken}`,
            },
            method: 'GET'
        },
    );
    
    const responseJson = await response.json();
    const data = responseJson as {
        email: string;
    };
    const email = data.email;

    return email || "zl@email.com"
}