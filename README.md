# Barbershop Pro English

Functional barbershop website with:
- English public website
- Real booking persistence on the server
- Admin login
- Booking status management
- Services CRUD
- Barbers CRUD
- Editable business details and opening hours
- Password change
- Optional WhatsApp hand-off after a booking is saved

## Run
1. Install Node.js 18+.
2. Open PowerShell in this folder.
3. Run: npm install
4. Run: npm start
5. Website: http://localhost:3000
6. Admin: http://localhost:3000/admin

The installer creates the initial admin password in `.env`. Change it from the Security tab after the first login.

## Production note
This project is fully functional for local use and demos. For a public commercial deployment, move persistent data to a managed database and use a persistent session store, HTTPS, backups and server hosting.
